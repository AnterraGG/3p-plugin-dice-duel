use anchor_lang::prelude::*;

use crate::constants::{SEED_CONFIG, SEED_PENDING_ADMIN};
use crate::errors::DiceDuelError;
use crate::events::AdminProposalCancelled;
use crate::state::{GameConfig, PendingAdmin};

#[derive(Accounts)]
pub struct CancelAdminProposalAccountConstraints<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ DiceDuelError::Unauthorized,
    )]
    pub config: Account<'info, GameConfig>,

    #[account(
        mut,
        seeds = [SEED_PENDING_ADMIN],
        bump = pending_admin.bump,
        close = admin,
    )]
    pub pending_admin: Account<'info, PendingAdmin>,

    pub system_program: Program<'info, System>,
}

pub fn handle_cancel_admin_proposal(
    ctx: Context<CancelAdminProposalAccountConstraints>,
) -> Result<()> {
    let cancelled_proposal = ctx.accounts.pending_admin.proposed_admin;

    // PDA account is closed by the `close` constraint

    emit!(AdminProposalCancelled {
        admin: ctx.accounts.admin.key(),
        cancelled_proposal,
    });

    Ok(())
}
