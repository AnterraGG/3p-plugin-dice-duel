use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum WagerStatus {
    Pending,
    Active,
    ReadyToSettle,
    Settled,
    Cancelled,
    Expired,
    VrfTimeout,
    Resolved,
}

impl Default for WagerStatus {
    fn default() -> Self {
        WagerStatus::Pending
    }
}

#[derive(InitSpace)]
#[account]
pub struct Wager {
    pub challenger: Pubkey,
    pub opponent: Pubkey,
    pub challenger_bag: Pubkey,
    pub amount: u64,
    pub game_type: u8,
    pub challenger_choice: u8,
    pub status: WagerStatus,
    pub nonce: u64,
    pub vrf_requested_at: i64,
    pub vrf_fulfilled_at: Option<i64>,
    pub vrf_result: Option<u8>,
    pub winner: Option<Pubkey>,
    pub created_at: i64,
    pub settled_at: Option<i64>,
    pub threshold: u8,
    pub payout_multiplier_bps: u32,
    pub escrow_bump: u8,
    pub bump: u8,
}
