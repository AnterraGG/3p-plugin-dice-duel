use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account]
pub struct PlayerStats {
    pub player: Pubkey,
    pub total_games: u32,
    pub wins: u32,
    pub losses: u32,
    pub sol_wagered: u64,
    pub sol_won: u64,
    pub current_streak: i32,
    pub best_streak: u32,
    pub wager_nonce: u64,
    pub pending_nonce: Option<u64>,
    pub bump: u8,
}
