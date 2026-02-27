use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::GameConfig;

#[derive(Accounts)]
pub struct PauseAccountConstraints<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Account<'info, GameConfig>,
}

pub fn handle_pause(context: Context<PauseAccountConstraints>) -> Result<()> {
    context.accounts.config.is_paused = true;
    Ok(())
}

pub fn handle_unpause(context: Context<PauseAccountConstraints>) -> Result<()> {
    context.accounts.config.is_paused = false;
    Ok(())
}
