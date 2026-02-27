use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::state::GameConfig;

#[derive(Accounts)]
pub struct InitializeAccountConstraints<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = GameConfig::DISCRIMINATOR.len() + GameConfig::INIT_SPACE,
        seeds = [SEED_CONFIG],
        bump,
    )]
    pub config: Account<'info, GameConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    context: Context<InitializeAccountConstraints>,
    treasury: Pubkey,
    fee_bps: u16,
    mint_price: u64,
    initial_uses: u8,
    wager_expiry_seconds: i64,
    vrf_timeout_seconds: i64,
) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, DiceDuelError::FeeTooHigh);
    require!(initial_uses > 0, DiceDuelError::InvalidInitialUses);
    require!(
        vrf_timeout_seconds > wager_expiry_seconds,
        DiceDuelError::InvalidTimeoutConfig
    );

    let config = &mut context.accounts.config;
    config.admin = context.accounts.admin.key();
    config.treasury = treasury;
    config.fee_bps = fee_bps;
    config.mint_price = mint_price;
    config.initial_uses = initial_uses;
    config.is_paused = false;
    config.wager_expiry_seconds = wager_expiry_seconds;
    config.vrf_timeout_seconds = vrf_timeout_seconds;
    config.bump = context.bumps.config;

    Ok(())
}
