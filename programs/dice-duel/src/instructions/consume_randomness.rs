use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::{DiceBagUsed, WagerResolved};
use crate::state::{DiceBag, GameConfig, PlayerStats, Wager, WagerStatus};

#[derive(Accounts)]
pub struct ConsumeRandomnessAccountConstraints<'info> {
    /// SECURITY: Validates callback is from the real VRF program.
    /// In test builds, any signer is accepted to enable integration testing
    /// of the settlement path without a real VRF oracle.
    #[cfg_attr(
        not(feature = "test-mode"),
        account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)
    )]
    pub vrf_program_identity: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_WAGER, wager.challenger.as_ref()],
        bump = wager.bump,
        constraint = wager.status == WagerStatus::Active @ DiceDuelError::InvalidWagerStatus,
    )]
    pub wager: Account<'info, Wager>,

    /// CHECK: Escrow PDA — raw lamport vault
    #[account(
        mut,
        seeds = [SEED_ESCROW, wager.key().as_ref()],
        bump = wager.escrow_bump,
    )]
    pub escrow: AccountInfo<'info>,

    /// CHECK: Challenger wallet — receives winnings/rent
    #[account(
        mut,
        constraint = challenger.key() == wager.challenger @ DiceDuelError::InvalidWagerStatus,
    )]
    pub challenger: SystemAccount<'info>,

    /// CHECK: Opponent wallet — receives winnings
    #[account(
        mut,
        constraint = opponent.key() == wager.opponent @ DiceDuelError::InvalidWagerStatus,
    )]
    pub opponent: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_DICE_BAG, wager.challenger_bag.as_ref()],
        bump = challenger_bag.bump,
    )]
    pub challenger_bag: Account<'info, DiceBag>,

    #[account(
        mut,
        seeds = [SEED_STATS, wager.challenger.as_ref()],
        bump = challenger_stats.bump,
    )]
    pub challenger_stats: Account<'info, PlayerStats>,

    #[account(
        mut,
        seeds = [SEED_STATS, wager.opponent.as_ref()],
        bump = opponent_stats.bump,
    )]
    pub opponent_stats: Account<'info, PlayerStats>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, GameConfig>,

    /// CHECK: Treasury receives fees, validated against config
    #[account(
        mut,
        constraint = treasury.key() == config.treasury,
    )]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_consume_randomness(
    context: Context<ConsumeRandomnessAccountConstraints>,
    randomness: [u8; 32],
) -> Result<()> {
    let wager = &context.accounts.wager;

    // Defense in depth
    require!(wager.amount > 0, DiceDuelError::InvalidAmount);
    require!(
        context.accounts.challenger.key() != context.accounts.opponent.key(),
        DiceDuelError::DuplicateAccounts
    );

    // Compute VRF result
    let result = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 0, 99);

    // Determine winner for high/low game
    let challenger_wins = if wager.game_type == HIGH_LOW_GAME_TYPE {
        if wager.challenger_choice == CHOICE_HIGH {
            result >= HIGH_LOW_THRESHOLD
        } else {
            result < HIGH_LOW_THRESHOLD
        }
    } else {
        // Future game types — default to high/low logic
        result >= HIGH_LOW_THRESHOLD
    };

    let (winner_key, _loser_key) = if challenger_wins {
        (wager.challenger, wager.opponent)
    } else {
        (wager.opponent, wager.challenger)
    };

    let winner_account = if challenger_wins {
        context.accounts.challenger.to_account_info()
    } else {
        context.accounts.opponent.to_account_info()
    };

    // Calculate payouts (all checked math)
    let total_pot = wager.amount.checked_mul(2).ok_or(DiceDuelError::Overflow)?;
    let fee = total_pot
        .checked_mul(context.accounts.config.fee_bps as u64)
        .ok_or(DiceDuelError::Overflow)?
        .checked_div(10_000)
        .ok_or(DiceDuelError::Overflow)?;
    let winner_payout = total_pot.checked_sub(fee).ok_or(DiceDuelError::Overflow)?;

    // PDA signing for escrow transfers
    let wager_key = wager.key();
    let escrow_seeds = &[SEED_ESCROW, wager_key.as_ref(), &[wager.escrow_bump]];
    let signer_seeds = &[&escrow_seeds[..]];

    // Transfer fee to treasury
    if fee > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                context.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: context.accounts.escrow.to_account_info(),
                    to: context.accounts.treasury.to_account_info(),
                },
                signer_seeds,
            ),
            fee,
        )?;
    }

    // Transfer winnings to winner
    system_program::transfer(
        CpiContext::new_with_signer(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.escrow.to_account_info(),
                to: winner_account,
            },
            signer_seeds,
        ),
        winner_payout,
    )?;

    let clock = Clock::get()?;

    // Update wager
    let wager = &mut context.accounts.wager;
    wager.status = WagerStatus::Settled;
    wager.vrf_result = Some(result);
    wager.winner = Some(winner_key);
    wager.settled_at = Some(clock.unix_timestamp);

    // Update DiceBag stats
    let challenger_bag = &mut context.accounts.challenger_bag;
    if challenger_wins {
        challenger_bag.wins = challenger_bag.wins.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    } else {
        challenger_bag.losses = challenger_bag.losses.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    }

    // Update PlayerStats for both
    let wager_amount = wager.amount;

    let challenger_stats = &mut context.accounts.challenger_stats;
    challenger_stats.total_games = challenger_stats.total_games.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    challenger_stats.sol_wagered = challenger_stats.sol_wagered.checked_add(wager_amount).ok_or(DiceDuelError::Overflow)?;
    if challenger_wins {
        challenger_stats.wins = challenger_stats.wins.checked_add(1).ok_or(DiceDuelError::Overflow)?;
        challenger_stats.sol_won = challenger_stats.sol_won.checked_add(winner_payout).ok_or(DiceDuelError::Overflow)?;
        if challenger_stats.current_streak >= 0 {
            challenger_stats.current_streak = challenger_stats.current_streak.checked_add(1).ok_or(DiceDuelError::Overflow)?;
        } else {
            challenger_stats.current_streak = 1;
        }
        if challenger_stats.current_streak as u32 > challenger_stats.best_streak {
            challenger_stats.best_streak = challenger_stats.current_streak as u32;
        }
    } else {
        challenger_stats.losses = challenger_stats.losses.checked_add(1).ok_or(DiceDuelError::Overflow)?;
        if challenger_stats.current_streak <= 0 {
            challenger_stats.current_streak = challenger_stats.current_streak.checked_sub(1).ok_or(DiceDuelError::Overflow)?;
        } else {
            challenger_stats.current_streak = -1;
        }
    }

    let opponent_stats = &mut context.accounts.opponent_stats;
    opponent_stats.total_games = opponent_stats.total_games.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    opponent_stats.sol_wagered = opponent_stats.sol_wagered.checked_add(wager_amount).ok_or(DiceDuelError::Overflow)?;
    if !challenger_wins {
        opponent_stats.wins = opponent_stats.wins.checked_add(1).ok_or(DiceDuelError::Overflow)?;
        opponent_stats.sol_won = opponent_stats.sol_won.checked_add(winner_payout).ok_or(DiceDuelError::Overflow)?;
        if opponent_stats.current_streak >= 0 {
            opponent_stats.current_streak = opponent_stats.current_streak.checked_add(1).ok_or(DiceDuelError::Overflow)?;
        } else {
            opponent_stats.current_streak = 1;
        }
        if opponent_stats.current_streak as u32 > opponent_stats.best_streak {
            opponent_stats.best_streak = opponent_stats.current_streak as u32;
        }
    } else {
        opponent_stats.losses = opponent_stats.losses.checked_add(1).ok_or(DiceDuelError::Overflow)?;
        if opponent_stats.current_streak <= 0 {
            opponent_stats.current_streak = opponent_stats.current_streak.checked_sub(1).ok_or(DiceDuelError::Overflow)?;
        } else {
            opponent_stats.current_streak = -1;
        }
    }

    // Emit DiceBagUsed after bag stats update
    emit!(DiceBagUsed {
        mint: challenger_bag.mint,
        owner: challenger_bag.owner,
        uses_remaining: challenger_bag.uses_remaining,
    });

    // Close escrow: zero data, drain remaining lamports to challenger
    let escrow = &context.accounts.escrow;
    escrow.assign(&system_program::ID);
    escrow.resize(0)?;
    let remaining = escrow.lamports();
    **escrow.try_borrow_mut_lamports()? -= remaining;
    **context.accounts.challenger.try_borrow_mut_lamports()? += remaining;

    emit!(WagerResolved {
        challenger: wager.challenger,
        opponent: wager.opponent,
        winner: winner_key,
        amount: wager_amount,
        vrf_result: result,
        fee,
        payout: winner_payout,
        settled_at: clock.unix_timestamp,
    });

    // Close wager account: zero data, drain rent to challenger
    let wager_info = context.accounts.wager.to_account_info();
    wager_info.assign(&system_program::ID);
    wager_info.resize(0)?;
    let wager_remaining = wager_info.lamports();
    **wager_info.try_borrow_mut_lamports()? -= wager_remaining;
    **context.accounts.challenger.try_borrow_mut_lamports()? += wager_remaining;

    Ok(())
}
