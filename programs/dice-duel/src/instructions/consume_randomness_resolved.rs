use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::WagerResolvedEvent;
use crate::state::{DiceBag, PlayerStats, Wager, WagerStatus};

/// VRF callback that determines the winner and updates stats in one shot.
/// A separate `claim_winnings` instruction handles SOL transfers.
#[derive(Accounts)]
pub struct ConsumeRandomnessResolvedAccountConstraints<'info> {
    #[cfg_attr(
        not(feature = "test-mode"),
        account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)
    )]
    pub vrf_program_identity: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_WAGER, wager.challenger.as_ref(), &wager.nonce.to_le_bytes()],
        bump = wager.bump,
        constraint = wager.status == WagerStatus::Active @ DiceDuelError::InvalidWagerStatus,
    )]
    pub wager: Account<'info, Wager>,

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
        mut,
        seeds = [SEED_DICE_BAG, challenger_bag.mint.as_ref()],
        bump = challenger_bag.bump,
        constraint = challenger_bag.key() == wager.challenger_bag @ DiceDuelError::InvalidWagerStatus,
    )]
    pub challenger_bag: Account<'info, DiceBag>,
}

pub fn handle_consume_randomness_resolved(
    context: Context<ConsumeRandomnessResolvedAccountConstraints>,
    randomness: [u8; 32],
) -> Result<()> {
    let wager = &context.accounts.wager;

    // Compute VRF result
    let result = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 0, 99);

    // Determine winner
    let challenger_wins = if wager.game_type == HIGH_LOW_GAME_TYPE {
        if wager.challenger_choice == CHOICE_HIGH {
            result >= HIGH_LOW_THRESHOLD
        } else {
            result < HIGH_LOW_THRESHOLD
        }
    } else {
        result >= HIGH_LOW_THRESHOLD
    };

    let (winner_key, _loser_key) = if challenger_wins {
        (wager.challenger, wager.opponent)
    } else {
        (wager.opponent, wager.challenger)
    };

    let clock = Clock::get()?;
    let wager_amount = wager.amount;
    let challenger_key = wager.challenger;
    let opponent_key = wager.opponent;
    let game_type = wager.game_type;
    let challenger_choice = wager.challenger_choice;
    let nonce = wager.nonce;

    // Update wager
    let wager = &mut context.accounts.wager;
    wager.vrf_result = Some(result);
    wager.winner = Some(winner_key);
    wager.status = WagerStatus::Resolved;
    wager.vrf_fulfilled_at = Some(clock.unix_timestamp);

    // Update DiceBag stats
    let challenger_bag = &mut context.accounts.challenger_bag;
    if challenger_wins {
        challenger_bag.wins = challenger_bag.wins.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    } else {
        challenger_bag.losses = challenger_bag.losses.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    }

    // Update challenger stats
    let challenger_stats = &mut context.accounts.challenger_stats;
    challenger_stats.total_games = challenger_stats.total_games.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    challenger_stats.sol_wagered = challenger_stats.sol_wagered.checked_add(wager_amount).ok_or(DiceDuelError::Overflow)?;
    if challenger_wins {
        challenger_stats.wins = challenger_stats.wins.checked_add(1).ok_or(DiceDuelError::Overflow)?;
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

    // Update opponent stats
    let opponent_stats = &mut context.accounts.opponent_stats;
    opponent_stats.total_games = opponent_stats.total_games.checked_add(1).ok_or(DiceDuelError::Overflow)?;
    opponent_stats.sol_wagered = opponent_stats.sol_wagered.checked_add(wager_amount).ok_or(DiceDuelError::Overflow)?;
    if !challenger_wins {
        opponent_stats.wins = opponent_stats.wins.checked_add(1).ok_or(DiceDuelError::Overflow)?;
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

    // NO pending_nonce changes — Active→Resolved, pending already cleared in accept_wager

    msg!("VRF resolved - result: {}, winner: {}", result, winner_key);

    emit!(WagerResolvedEvent {
        challenger: challenger_key,
        opponent: opponent_key,
        winner: winner_key,
        amount: wager_amount,
        vrf_result: result,
        game_type,
        challenger_choice,
        nonce,
    });

    Ok(())
}
