use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PendingAdmin {
    pub proposed_admin: Pubkey,
    pub proposed_by: Pubkey,
    pub proposed_at: i64,
    pub bump: u8,
}
