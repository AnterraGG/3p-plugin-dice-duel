use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account]
pub struct GameConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub mint_price: u64,
    pub initial_uses: u8,
    pub is_paused: bool,
    pub wager_expiry_seconds: i64,
    pub vrf_timeout_seconds: i64,
    pub bump: u8,
}
