use anchor_lang::prelude::*;

use crate::constants::{SEED_CONFIG, SEED_PENDING_ADMIN};
use crate::errors::DiceDuelError;
use crate::events::AdminTransferred;
use crate::state::{GameConfig, PendingAdmin};

#[derive(Accounts)]
pub struct AcceptAdminAccountConstraints<'info> {
    #[account(mut)]
    pub new_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, GameConfig>,

    #[account(
        mut,
        seeds = [SEED_PENDING_ADMIN],
        bump = pending_admin.bump,
        close = new_admin,
    )]
    pub pending_admin: Account<'info, PendingAdmin>,

    pub system_program: Program<'info, System>,
}

pub fn handle_accept_admin(ctx: Context<AcceptAdminAccountConstraints>) -> Result<()> {
    let pending = &ctx.accounts.pending_admin;

    // Verify the signer is the proposed admin
    require!(
        ctx.accounts.new_admin.key() == pending.proposed_admin,
        DiceDuelError::NotPendingAdmin
    );

    let old_admin = ctx.accounts.config.admin;

    // Transfer admin role
    ctx.accounts.config.admin = ctx.accounts.new_admin.key();

    // PDA account is closed by the `close` constraint

    emit!(AdminTransferred {
        old_admin,
        new_admin: ctx.accounts.new_admin.key(),
    });

    Ok(())
}
