use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::state::{GameConfig, GameType};

#[derive(Accounts)]
pub struct UpdateGameTypeAccountConstraints<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Account<'info, GameConfig>,

    #[account(
        mut,
        seeds = [SEED_GAME_TYPE, game_type.id.to_le_bytes().as_ref()],
        bump = game_type.bump,
    )]
    pub game_type: Account<'info, GameType>,
}

pub fn handle_update_game_type(
    context: Context<UpdateGameTypeAccountConstraints>,
    name: Option<String>,
    enabled: Option<bool>,
) -> Result<()> {
    let game_type = &mut context.accounts.game_type;

    if let Some(n) = name {
        require!(n.len() <= 32, DiceDuelError::InvalidGameTypeName);
        let mut name_bytes = [0u8; 32];
        let bytes = n.as_bytes();
        name_bytes[..bytes.len()].copy_from_slice(bytes);
        game_type.name = name_bytes;
    }

    if let Some(e) = enabled {
        game_type.enabled = e;
    }

    Ok(())
}
