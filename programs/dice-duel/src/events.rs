use anchor_lang::prelude::*;

#[event]
pub struct AdminProposed {
    pub current_admin: Pubkey,
    pub proposed_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AdminProposalCancelled {
    pub admin: Pubkey,
    pub cancelled_proposal: Pubkey,
}

#[event]
pub struct DiceBagMinted {
    pub player: Pubkey,
    pub mint: Pubkey,
    pub uses: u8,
}

#[event]
pub struct DiceBagUsed {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub uses_remaining: u8,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
}

#[event]
pub struct WagerInitiated {
    pub challenger: Pubkey,
    pub opponent: Pubkey,
    pub amount: u64,
    pub game_type: u8,
    pub nonce: u64,
    pub created_at: i64,
}

#[event]
pub struct WagerAccepted {
    pub challenger: Pubkey,
    pub opponent: Pubkey,
    pub amount: u64,
    pub nonce: u64,
}

#[event]
pub struct WagerResolved {
    pub challenger: Pubkey,
    pub opponent: Pubkey,
    pub winner: Pubkey,
    pub amount: u64,
    pub vrf_result: u8,
    pub fee: u64,
    pub payout: u64,
    pub settled_at: i64,
}

#[event]
pub struct WagerResolvedEvent {
    pub challenger: Pubkey,
    pub opponent: Pubkey,
    pub winner: Pubkey,
    pub amount: u64,
    pub vrf_result: u8,
    pub game_type: u8,
    pub challenger_choice: u8,
    pub nonce: u64,
}

#[event]
pub struct WinningsClaimed {
    pub winner: Pubkey,
    pub challenger: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub payout: u64,
    pub nonce: u64,
    pub settled_at: i64,
}

#[event]
pub struct WagerCancelled {
    pub challenger: Pubkey,
    pub nonce: u64,
    pub settled_at: i64,
}

#[event]
pub struct WagerExpiredEvent {
    pub challenger: Pubkey,
    pub opponent: Pubkey,
    pub nonce: u64,
    pub settled_at: i64,
}

#[event]
pub struct VrfTimeoutRefund {
    pub challenger: Pubkey,
    pub opponent: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub settled_at: i64,
}
