use anchor_lang::prelude::*;
use anchor_lang::system_program;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::WagerAccepted;
use crate::state::{DiceBag, GameConfig, PlayerStats, Wager, WagerStatus};

#[vrf]
#[derive(Accounts)]
pub struct AcceptWagerAccountConstraints<'info> {
    #[account(mut)]
    pub opponent: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_WAGER, wager.challenger.as_ref(), &wager.nonce.to_le_bytes()],
        bump = wager.bump,
        has_one = challenger,
        has_one = opponent,
        has_one = challenger_bag,
    )]
    pub wager: Account<'info, Wager>,

    /// CHECK: Challenger wallet — validated via has_one on wager
    pub challenger: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_DICE_BAG, challenger_bag.mint.as_ref()],
        bump = challenger_bag.bump,
    )]
    pub challenger_bag: Account<'info, DiceBag>,

    /// CHECK: Escrow PDA — raw lamport vault
    #[account(
        mut,
        seeds = [SEED_ESCROW, wager.key().as_ref()],
        bump = wager.escrow_bump,
    )]
    pub escrow: AccountInfo<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, GameConfig>,

    /// Challenger's PlayerStats — guaranteed to exist from initiate_wager (M-01).
    /// NOT init_if_needed — prevents opponent from paying rent for challenger's stats.
    #[account(
        mut,
        seeds = [SEED_STATS, wager.challenger.as_ref()],
        bump = challenger_stats.bump,
    )]
    pub challenger_stats: Account<'info, PlayerStats>,

    #[account(
        init_if_needed,
        payer = opponent,
        space = PlayerStats::DISCRIMINATOR.len() + PlayerStats::INIT_SPACE,
        seeds = [SEED_STATS, opponent.key().as_ref()],
        bump,
    )]
    pub opponent_stats: Account<'info, PlayerStats>,

    /// CHECK: Oracle queue for VRF
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_accept_wager(context: Context<AcceptWagerAccountConstraints>) -> Result<()> {
    require!(!context.accounts.config.is_paused, DiceDuelError::GamePaused);

    let wager = &context.accounts.wager;
    require!(wager.status == WagerStatus::Pending, DiceDuelError::InvalidWagerStatus);
    require!(wager.amount > 0, DiceDuelError::InvalidAmount);
    require!(context.accounts.challenger_bag.uses_remaining > 0, DiceDuelError::BagExhausted);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp.checked_sub(wager.created_at).ok_or(DiceDuelError::Overflow)? < context.accounts.config.wager_expiry_seconds,
        DiceDuelError::WagerExpired
    );

    // Nonce freshness check — reject stale wagers
    require!(
        context.accounts.challenger_stats.pending_nonce == Some(wager.nonce),
        DiceDuelError::WagerStale
    );

    // Verify challenger's escrow is present
    require!(
        context.accounts.escrow.lamports() >= wager.amount,
        DiceDuelError::EscrowBalanceMismatch
    );

    // Transfer opponent's wager to escrow
    system_program::transfer(
        CpiContext::new(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.opponent.to_account_info(),
                to: context.accounts.escrow.to_account_info(),
            },
        ),
        wager.amount,
    )?;

    // Decrement bag uses
    let challenger_bag = &mut context.accounts.challenger_bag;
    challenger_bag.uses_remaining = challenger_bag.uses_remaining.checked_sub(1).ok_or(DiceDuelError::Overflow)?;
    challenger_bag.total_games = challenger_bag.total_games.checked_add(1).ok_or(DiceDuelError::Overflow)?;

    // Init opponent stats if new
    let opponent_stats = &mut context.accounts.opponent_stats;
    if opponent_stats.player == Pubkey::default() {
        opponent_stats.player = context.accounts.opponent.key();
        opponent_stats.bump = context.bumps.opponent_stats;
    }

    // Build callback accounts for resolved callback (VRF identity is added automatically by oracle)
    let wager_key = context.accounts.wager.key();
    let challenger_stats_key = context.accounts.challenger_stats.key();
    let opponent_stats_key = context.accounts.opponent_stats.key();
    let challenger_bag_key = context.accounts.challenger_bag.key();

    let callback_accounts = vec![
        SerializableAccountMeta { pubkey: wager_key, is_signer: false, is_writable: true },
        SerializableAccountMeta { pubkey: challenger_stats_key, is_signer: false, is_writable: true },
        SerializableAccountMeta { pubkey: opponent_stats_key, is_signer: false, is_writable: true },
        SerializableAccountMeta { pubkey: challenger_bag_key, is_signer: false, is_writable: true },
    ];

    // Request VRF using resolved callback
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: context.accounts.opponent.key(),
        oracle_queue: context.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ConsumeRandomnessResolved::DISCRIMINATOR.to_vec(),
        caller_seed: [0u8; 32],
        accounts_metas: Some(callback_accounts),
        ..Default::default()
    });

    // Manual CPI — the #[vrf] macro's invoke_signed_vrf is buggy:
    // it omits system_program from account_infos and has wrong ordering.
    // The VRF program expects: [payer, program_identity, oracle_queue, system_program, slot_hashes]
    let (_, identity_bump) = Pubkey::find_program_address(
        &[ephemeral_vrf_sdk::consts::IDENTITY],
        &crate::ID,
    );
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            context.accounts.opponent.to_account_info(),
            context.accounts.program_identity.to_account_info(),
            context.accounts.oracle_queue.to_account_info(),
            context.accounts.system_program.to_account_info(),
            context.accounts.slot_hashes.to_account_info(),
        ],
        &[&[ephemeral_vrf_sdk::consts::IDENTITY, &[identity_bump]]],
    )?;

    // Update wager status
    let wager = &mut context.accounts.wager;
    wager.status = WagerStatus::Active;
    wager.vrf_requested_at = clock.unix_timestamp;

    // Clear pending_nonce — wager is no longer Pending
    context.accounts.challenger_stats.pending_nonce = None;

    emit!(WagerAccepted {
        challenger: wager.challenger,
        opponent: context.accounts.opponent.key(),
        amount: wager.amount,
        nonce: wager.nonce,
    });

    Ok(())
}
