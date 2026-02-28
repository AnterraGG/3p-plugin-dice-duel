use anchor_lang::prelude::*;

use crate::constants::{SEED_CONFIG, SEED_PENDING_ADMIN};
use crate::errors::DiceDuelError;
use crate::events::AdminProposed;
use crate::state::{GameConfig, PendingAdmin};

#[derive(Accounts)]
pub struct ProposeAdminAccountConstraints<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ DiceDuelError::Unauthorized,
    )]
    pub config: Account<'info, GameConfig>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + PendingAdmin::INIT_SPACE,
        seeds = [SEED_PENDING_ADMIN],
        bump,
    )]
    pub pending_admin: Account<'info, PendingAdmin>,

    pub system_program: Program<'info, System>,
}

pub fn handle_propose_admin(
    ctx: Context<ProposeAdminAccountConstraints>,
    new_admin: Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;

    let pending = &mut ctx.accounts.pending_admin;
    pending.proposed_admin = new_admin;
    pending.proposed_by = ctx.accounts.admin.key();
    pending.proposed_at = clock.unix_timestamp;
    pending.bump = ctx.bumps.pending_admin;

    emit!(AdminProposed {
        current_admin: ctx.accounts.admin.key(),
        proposed_admin: new_admin,
    });

    Ok(())
}
