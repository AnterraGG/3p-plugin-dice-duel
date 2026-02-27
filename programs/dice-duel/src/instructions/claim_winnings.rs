use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::WinningsClaimed;
use crate::state::{GameConfig, Wager, WagerStatus};

#[derive(Accounts)]
pub struct ClaimWinningsAccountConstraints<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_WAGER, wager.challenger.as_ref(), &wager.nonce.to_le_bytes()],
        bump = wager.bump,
        constraint = wager.status == WagerStatus::Resolved @ DiceDuelError::InvalidWagerStatus,
        constraint = wager.winner == Some(claimer.key()) @ DiceDuelError::Unauthorized,
        close = challenger,
    )]
    pub wager: Account<'info, Wager>,

    /// CHECK: Escrow PDA — raw lamport vault
    #[account(
        mut,
        seeds = [SEED_ESCROW, wager.key().as_ref()],
        bump = wager.escrow_bump,
    )]
    pub escrow: AccountInfo<'info>,

    /// CHECK: Challenger wallet — receives rent refunds
    #[account(
        mut,
        constraint = challenger.key() == wager.challenger @ DiceDuelError::InvalidWagerStatus,
    )]
    pub challenger: SystemAccount<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, GameConfig>,

    /// CHECK: Treasury receives fees
    #[account(
        mut,
        constraint = treasury.key() == config.treasury,
    )]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_winnings(context: Context<ClaimWinningsAccountConstraints>) -> Result<()> {
    let wager = &context.accounts.wager;

    // Read challenger before wager closes
    let challenger_key = wager.challenger;
    let nonce = wager.nonce;

    // Calculate payouts
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

    // Transfer winnings to claimer
    system_program::transfer(
        CpiContext::new_with_signer(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.escrow.to_account_info(),
                to: context.accounts.claimer.to_account_info(),
            },
            signer_seeds,
        ),
        winner_payout,
    )?;

    let clock = Clock::get()?;
    let wager_amount = wager.amount;

    // Update wager
    let wager = &mut context.accounts.wager;
    wager.status = WagerStatus::Settled;
    wager.settled_at = Some(clock.unix_timestamp);

    // Drain any remaining dust from escrow to challenger (H-01)
    let remaining = context.accounts.escrow.lamports();
    if remaining > 0 {
        **context.accounts.escrow.try_borrow_mut_lamports()? -= remaining;
        **context.accounts.challenger.try_borrow_mut_lamports()? += remaining;
    }

    // NO nonce freshness check — winner ALWAYS gets paid
    // NO pending_nonce changes — was already cleared when wager was accepted

    emit!(WinningsClaimed {
        winner: context.accounts.claimer.key(),
        challenger: challenger_key,
        amount: wager_amount,
        fee,
        payout: winner_payout,
        nonce,
        settled_at: clock.unix_timestamp,
    });

    Ok(())
}
