use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::VrfTimeoutRefund;
use crate::state::{GameConfig, Wager, WagerStatus};

#[derive(Accounts)]
pub struct ClaimVrfTimeoutAccountConstraints<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_WAGER, wager.challenger.as_ref(), &wager.nonce.to_le_bytes()],
        bump = wager.bump,
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

    /// CHECK: Challenger wallet — receives refund + rent
    #[account(
        mut,
        constraint = challenger.key() == wager.challenger,
    )]
    pub challenger: SystemAccount<'info>,

    /// CHECK: Opponent wallet — receives refund
    #[account(
        mut,
        constraint = opponent.key() == wager.opponent,
    )]
    pub opponent: SystemAccount<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, GameConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_vrf_timeout(context: Context<ClaimVrfTimeoutAccountConstraints>) -> Result<()> {
    let wager = &context.accounts.wager;
    require!(wager.status == WagerStatus::Active, DiceDuelError::InvalidWagerStatus);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp.checked_sub(wager.vrf_requested_at).ok_or(DiceDuelError::Overflow)? > context.accounts.config.vrf_timeout_seconds,
        DiceDuelError::VrfNotTimedOut
    );

    require!(
        context.accounts.challenger.key() != context.accounts.opponent.key(),
        DiceDuelError::DuplicateAccounts
    );

    let wager_key = wager.key();
    let escrow_seeds = &[SEED_ESCROW, wager_key.as_ref(), &[wager.escrow_bump]];
    let signer_seeds = &[&escrow_seeds[..]];

    // Refund challenger
    system_program::transfer(
        CpiContext::new_with_signer(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.escrow.to_account_info(),
                to: context.accounts.challenger.to_account_info(),
            },
            signer_seeds,
        ),
        wager.amount,
    )?;

    // Refund opponent
    system_program::transfer(
        CpiContext::new_with_signer(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.escrow.to_account_info(),
                to: context.accounts.opponent.to_account_info(),
            },
            signer_seeds,
        ),
        wager.amount,
    )?;

    // Drain any dust (H-01: no assign()/resize() on system-owned escrow PDAs)
    let remaining = context.accounts.escrow.lamports();
    if remaining > 0 {
        **context.accounts.escrow.try_borrow_mut_lamports()? -= remaining;
        **context.accounts.challenger.try_borrow_mut_lamports()? += remaining;
    }

    let nonce = wager.nonce;

    let wager = &mut context.accounts.wager;
    let amount = wager.amount;
    wager.status = WagerStatus::VrfTimeout;
    wager.settled_at = Some(clock.unix_timestamp);

    // NO pending_nonce changes — Active wager, pending already cleared in accept_wager

    emit!(VrfTimeoutRefund {
        challenger: wager.challenger,
        opponent: wager.opponent,
        amount,
        nonce,
        settled_at: clock.unix_timestamp,
    });

    Ok(())
}
