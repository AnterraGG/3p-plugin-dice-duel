use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::state::{GameConfig, GameType};

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct RegisterGameTypeAccountConstraints<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Account<'info, GameConfig>,

    #[account(
        init,
        payer = admin,
        space = GameType::DISCRIMINATOR.len() + GameType::INIT_SPACE,
        seeds = [SEED_GAME_TYPE, id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game_type: Account<'info, GameType>,

    pub system_program: Program<'info, System>,
}

pub fn handle_register_game_type(
    context: Context<RegisterGameTypeAccountConstraints>,
    id: u8,
    name: String,
    enabled: bool,
) -> Result<()> {
    require!(name.len() <= 32, DiceDuelError::InvalidGameTypeName);

    let game_type = &mut context.accounts.game_type;
    game_type.id = id;

    let mut name_bytes = [0u8; 32];
    let bytes = name.as_bytes();
    name_bytes[..bytes.len()].copy_from_slice(bytes);
    game_type.name = name_bytes;

    game_type.enabled = enabled;
    game_type.bump = context.bumps.game_type;

    Ok(())
}
