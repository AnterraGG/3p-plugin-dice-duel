use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::WagerCancelled;
use crate::state::{PlayerStats, Wager, WagerStatus};

#[derive(Accounts)]
pub struct CancelWagerAccountConstraints<'info> {
    #[account(mut)]
    pub challenger: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_WAGER, challenger.key().as_ref(), &wager.nonce.to_le_bytes()],
        bump = wager.bump,
        has_one = challenger,
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

    /// Challenger's PlayerStats — guaranteed to exist from initiate_wager.
    #[account(
        mut,
        seeds = [SEED_STATS, challenger.key().as_ref()],
        bump = challenger_stats.bump,
    )]
    pub challenger_stats: Account<'info, PlayerStats>,

    pub system_program: Program<'info, System>,
}

pub fn handle_cancel_wager(context: Context<CancelWagerAccountConstraints>) -> Result<()> {
    let wager = &context.accounts.wager;
    require!(wager.status == WagerStatus::Pending, DiceDuelError::InvalidWagerStatus);

    // Transfer escrow lamports back to challenger via CPI
    let escrow_balance = context.accounts.escrow.lamports();
    if escrow_balance > 0 {
        let wager_key = wager.key();
        let escrow_seeds = &[SEED_ESCROW, wager_key.as_ref(), &[wager.escrow_bump]];
        let signer_seeds = &[&escrow_seeds[..]];

        system_program::transfer(
            CpiContext::new_with_signer(
                context.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: context.accounts.escrow.to_account_info(),
                    to: context.accounts.challenger.to_account_info(),
                },
                signer_seeds,
            ),
            escrow_balance,
        )?;
    }

    // Drain any dust (H-01: no assign()/resize() on system-owned escrow PDAs)
    let remaining = context.accounts.escrow.lamports();
    if remaining > 0 {
        **context.accounts.escrow.try_borrow_mut_lamports()? -= remaining;
        **context.accounts.challenger.try_borrow_mut_lamports()? += remaining;
    }

    let clock = Clock::get()?;
    let nonce = wager.nonce;

    let wager = &mut context.accounts.wager;
    wager.status = WagerStatus::Cancelled;
    wager.settled_at = Some(clock.unix_timestamp);

    // Clear pending_nonce if this wager was the pending one
    if context.accounts.challenger_stats.pending_nonce == Some(nonce) {
        context.accounts.challenger_stats.pending_nonce = None;
    }

    emit!(WagerCancelled {
        challenger: context.accounts.challenger.key(),
        nonce,
        settled_at: clock.unix_timestamp,
    });

    Ok(())
}
