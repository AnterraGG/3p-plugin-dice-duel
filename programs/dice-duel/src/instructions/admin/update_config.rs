use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::state::GameConfig;

#[derive(Accounts)]
pub struct UpdateConfigAccountConstraints<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Account<'info, GameConfig>,
}

pub fn handle_update_config(
    context: Context<UpdateConfigAccountConstraints>,
    treasury: Option<Pubkey>,
    fee_bps: Option<u16>,
    mint_price: Option<u64>,
    initial_uses: Option<u8>,
    wager_expiry_seconds: Option<i64>,
    vrf_timeout_seconds: Option<i64>,
) -> Result<()> {
    let config = &mut context.accounts.config;

    if let Some(fee) = fee_bps {
        require!(fee <= MAX_FEE_BPS, DiceDuelError::FeeTooHigh);
        config.fee_bps = fee;
    }

    if let Some(uses) = initial_uses {
        require!(uses > 0, DiceDuelError::InvalidInitialUses);
        config.initial_uses = uses;
    }

    if let Some(t) = treasury {
        config.treasury = t;
    }

    if let Some(p) = mint_price {
        config.mint_price = p;
    }

    if let Some(w) = wager_expiry_seconds {
        config.wager_expiry_seconds = w;
    }

    if let Some(v) = vrf_timeout_seconds {
        config.vrf_timeout_seconds = v;
    }

    // Cross-validate timeout > expiry
    require!(
        config.vrf_timeout_seconds > config.wager_expiry_seconds,
        DiceDuelError::InvalidTimeoutConfig
    );

    Ok(())
}
