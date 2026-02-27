use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account]
pub struct DiceBag {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub uses_remaining: u8,
    pub total_games: u32,
    pub wins: u32,
    pub losses: u32,
    pub bump: u8,
}
