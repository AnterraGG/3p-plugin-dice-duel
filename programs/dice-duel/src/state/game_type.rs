use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account]
pub struct GameType {
    pub id: u8,
    pub name: [u8; 32],
    pub enabled: bool,
    pub bump: u8,
}
