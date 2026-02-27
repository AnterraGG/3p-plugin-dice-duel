use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::{WagerCancelled, WagerInitiated};
use crate::state::{DiceBag, GameConfig, GameType, PlayerStats, Wager, WagerStatus};

#[derive(Accounts)]
#[instruction(opponent: Pubkey, amount: u64, game_type: u8)]
pub struct InitiateWagerAccountConstraints<'info> {
    #[account(mut)]
    pub challenger: Signer<'info>,

    #[account(
        seeds = [SEED_DICE_BAG, challenger_bag.mint.as_ref()],
        bump = challenger_bag.bump,
        constraint = challenger_bag.owner == challenger.key() @ DiceDuelError::BagNotOwned,
    )]
    pub challenger_bag: Account<'info, DiceBag>,

    /// Challenger's PlayerStats — init_if_needed for first-time players.
    /// Required to read/write wager_nonce and pending_nonce.
    #[account(
        init_if_needed,
        payer = challenger,
        space = PlayerStats::DISCRIMINATOR.len() + PlayerStats::INIT_SPACE,
        seeds = [SEED_STATS, challenger.key().as_ref()],
        bump,
    )]
    pub challenger_stats: Account<'info, PlayerStats>,

    /// New wager account — unique PDA with nonce.
    /// Uses `init` (NOT init_if_needed) — every wager is unique.
    /// PDA seeds use the current wager_nonce value (before increment in handler).
    #[account(
        init,
        payer = challenger,
        space = Wager::DISCRIMINATOR.len() + Wager::INIT_SPACE,
        seeds = [SEED_WAGER, challenger.key().as_ref(), &challenger_stats.wager_nonce.to_le_bytes()],
        bump,
    )]
    pub wager: Account<'info, Wager>,

    /// CHECK: Escrow PDA — raw lamport vault for the new wager
    #[account(
        mut,
        seeds = [SEED_ESCROW, wager.key().as_ref()],
        bump,
    )]
    pub escrow: AccountInfo<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, GameConfig>,

    #[account(
        seeds = [SEED_GAME_TYPE, game_type.to_le_bytes().as_ref()],
        bump = game_type_account.bump,
    )]
    pub game_type_account: Account<'info, GameType>,

    /// Optional: previous stale pending wager to close and reclaim rent.
    /// REQUIRED when challenger_stats.pending_nonce.is_some().
    #[account(
        mut,
        seeds = [SEED_WAGER, challenger.key().as_ref(), &prev_wager.nonce.to_le_bytes()],
        bump = prev_wager.bump,
        constraint = prev_wager.challenger == challenger.key(),
        constraint = prev_wager.status == WagerStatus::Pending @ DiceDuelError::InvalidWagerStatus,
        close = challenger,
    )]
    pub prev_wager: Option<Account<'info, Wager>>,

    /// Optional: previous wager's escrow to refund.
    /// Required when prev_wager is provided.
    /// CHECK: validated by PDA seeds
    #[account(
        mut,
        seeds = [SEED_ESCROW, prev_wager.as_ref().map(|w| w.key()).unwrap_or_default().as_ref()],
        bump,
    )]
    pub prev_escrow: Option<AccountInfo<'info>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initiate_wager(
    context: Context<InitiateWagerAccountConstraints>,
    opponent: Pubkey,
    amount: u64,
    game_type: u8,
    challenger_choice: u8,
) -> Result<()> {
    // 1. Standard validations
    require!(!context.accounts.config.is_paused, DiceDuelError::GamePaused);
    require!(context.accounts.challenger.key() != opponent, DiceDuelError::SelfWager);
    require!(context.accounts.challenger_bag.uses_remaining > 0, DiceDuelError::BagExhausted);
    require!(amount > 0, DiceDuelError::InvalidAmount);
    require!(context.accounts.game_type_account.enabled, DiceDuelError::GameTypeDisabled);

    // Validate choice for game type
    if game_type == HIGH_LOW_GAME_TYPE {
        require!(
            challenger_choice == CHOICE_LOW || challenger_choice == CHOICE_HIGH,
            DiceDuelError::InvalidChoice
        );
    }

    let clock = Clock::get()?;

    // 2. Init PlayerStats if new (player == Pubkey::default())
    let challenger_stats = &mut context.accounts.challenger_stats;
    if challenger_stats.player == Pubkey::default() {
        challenger_stats.player = context.accounts.challenger.key();
        challenger_stats.bump = context.bumps.challenger_stats;
    }

    // 3. Validate optional account pairing — both present or both absent
    require!(
        context.accounts.prev_wager.is_some() == context.accounts.prev_escrow.is_some(),
        DiceDuelError::PreviousWagerRequired
    );

    // 3b. Defense-in-depth: reject prev_wager when pending_nonce is None (I-06).
    // Prevents escrow trapping if caller passes prev_wager with no pending nonce.
    if challenger_stats.pending_nonce.is_none() && context.accounts.prev_wager.is_some() {
        return Err(DiceDuelError::PreviousWagerRequired.into());
    }

    // 4. PROTOCOL-ENFORCED CLEANUP: if pending_nonce is Some, prev_wager MUST be provided
    if let Some(pending) = challenger_stats.pending_nonce {
        require!(
            context.accounts.prev_wager.is_some(),
            DiceDuelError::PreviousWagerRequired
        );

        // Explicit nonce match — prev_wager MUST be the exact wager tracked by pending_nonce (H-02).
        if let Some(ref prev) = context.accounts.prev_wager {
            require!(prev.nonce == pending, DiceDuelError::WagerNonceMismatch);
        }

        // Refund prev_escrow to challenger
        if let Some(ref prev_escrow) = context.accounts.prev_escrow {
            let escrow_balance = prev_escrow.lamports();
            if escrow_balance > 0 {
                // CPI transfer via system program with PDA signer seeds
                let prev_wager_ref = context.accounts.prev_wager.as_ref().unwrap();
                let prev_wager_key = prev_wager_ref.key();
                let escrow_seeds = &[SEED_ESCROW, prev_wager_key.as_ref(), &[prev_wager_ref.escrow_bump]];
                let signer_seeds = &[&escrow_seeds[..]];

                system_program::transfer(
                    CpiContext::new_with_signer(
                        context.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: prev_escrow.to_account_info(),
                            to: context.accounts.challenger.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    escrow_balance,
                )?;
            }

            // Drain any dust (H-01)
            let remaining = prev_escrow.lamports();
            if remaining > 0 {
                **prev_escrow.try_borrow_mut_lamports()? -= remaining;
                **context.accounts.challenger.try_borrow_mut_lamports()? += remaining;
            }
        }

        // prev_wager closed via Anchor `close = challenger` constraint
        // Emit WagerCancelled event for the old wager
        emit!(WagerCancelled {
            challenger: context.accounts.challenger.key(),
            nonce: pending,
            settled_at: clock.unix_timestamp,
        });
    }

    // 5. Create new wager at current nonce
    let current_nonce = challenger_stats.wager_nonce;

    // Transfer new amount to escrow
    system_program::transfer(
        CpiContext::new(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.challenger.to_account_info(),
                to: context.accounts.escrow.to_account_info(),
            },
        ),
        amount,
    )?;

    // Set wager fields
    let wager = &mut context.accounts.wager;
    wager.challenger = context.accounts.challenger.key();
    wager.opponent = opponent;
    wager.challenger_bag = context.accounts.challenger_bag.key();
    wager.amount = amount;
    wager.game_type = game_type;
    wager.challenger_choice = challenger_choice;
    wager.status = WagerStatus::Pending;
    wager.nonce = current_nonce;
    wager.vrf_requested_at = 0;
    wager.vrf_fulfilled_at = None;
    wager.vrf_result = None;
    wager.winner = None;
    wager.created_at = clock.unix_timestamp;
    wager.settled_at = None;
    wager.threshold = HIGH_LOW_THRESHOLD;
    wager.payout_multiplier_bps = DEFAULT_PAYOUT_MULTIPLIER_BPS;
    wager.escrow_bump = context.bumps.escrow;
    wager.bump = context.bumps.wager;

    // 6. Update PlayerStats
    let challenger_stats = &mut context.accounts.challenger_stats;
    challenger_stats.wager_nonce = current_nonce.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    challenger_stats.pending_nonce = Some(current_nonce);

    // 7. Emit event
    emit!(WagerInitiated {
        challenger: context.accounts.challenger.key(),
        opponent,
        amount,
        game_type,
        nonce: current_nonce,
        created_at: clock.unix_timestamp,
    });

    Ok(())
}
