use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::WagerCancelled;
use crate::state::{PlayerStats, Wager, WagerStatus};

/// Permissionless instruction for recovering abandoned stale wagers.
/// Anyone can call it. Escrow and rent are refunded to the challenger, not the caller.
#[derive(Accounts)]
pub struct CleanupStaleWagerAccountConstraints<'info> {
    /// Anyone can call this — permissionless
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The stale wager to close. Must be Pending + nonce stale.
    /// `close = challenger` zeroes the discriminator (prevents resurrection) and sends rent to challenger.
    #[account(
        mut,
        seeds = [SEED_WAGER, wager.challenger.as_ref(), &wager.nonce.to_le_bytes()],
        bump = wager.bump,
        constraint = wager.status == WagerStatus::Pending @ DiceDuelError::InvalidWagerStatus,
        close = challenger,
    )]
    pub wager: Account<'info, Wager>,

    /// Challenger's PlayerStats — used to verify staleness
    #[account(
        mut,
        seeds = [SEED_STATS, wager.challenger.as_ref()],
        bump = challenger_stats.bump,
    )]
    pub challenger_stats: Account<'info, PlayerStats>,

    /// CHECK: Escrow PDA — refunded to challenger
    #[account(
        mut,
        seeds = [SEED_ESCROW, wager.key().as_ref()],
        bump = wager.escrow_bump,
    )]
    pub escrow: AccountInfo<'info>,

    /// CHECK: Challenger wallet — receives escrow refund + rent
    #[account(
        mut,
        constraint = challenger.key() == wager.challenger,
    )]
    pub challenger: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_cleanup_stale_wager(
    context: Context<CleanupStaleWagerAccountConstraints>,
) -> Result<()> {
    let wager = &context.accounts.wager;
    let stats = &context.accounts.challenger_stats;

    // Verify the wager is provably stale:
    // pending_nonce != Some(wager.nonce) means the challenger has moved on
    require!(
        stats.pending_nonce != Some(wager.nonce),
        DiceDuelError::InvalidWagerStatus
    );

    // Refund escrow to challenger using the proven cancel_wager pattern:
    // 1. CPI transfer via system program with PDA signer seeds (moves the wager amount)
    // 2. Direct lamport drain for any dust (rent-exempt residual)
    // NOTE: Do NOT use assign()/resize() — our program doesn't own the escrow (system program does).
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

    // Drain any remaining dust lamports from escrow (H-01)
    let remaining = context.accounts.escrow.lamports();
    if remaining > 0 {
        **context.accounts.escrow.try_borrow_mut_lamports()? -= remaining;
        **context.accounts.challenger.try_borrow_mut_lamports()? += remaining;
    }

    // Wager account closed via Anchor `close = challenger` constraint (zeroes discriminator + sends rent)

    let clock = Clock::get()?;
    emit!(WagerCancelled {
        challenger: wager.challenger,
        nonce: wager.nonce,
        settled_at: clock.unix_timestamp,
    });

    Ok(())
}
