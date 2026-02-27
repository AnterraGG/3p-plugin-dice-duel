use anchor_lang::prelude::*;
use anchor_lang::system_program;
use mpl_core::{
    instructions::CreateV2CpiBuilder,
    types::{Plugin, PluginAuthority, PermanentFreezeDelegate},
};

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::events::DiceBagMinted;
use crate::state::{DiceBag, GameConfig};

#[derive(Accounts)]
pub struct MintDiceBagAccountConstraints<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, GameConfig>,

    #[account(mut)]
    pub mint: Signer<'info>,

    #[account(
        init,
        payer = player,
        space = DiceBag::DISCRIMINATOR.len() + DiceBag::INIT_SPACE,
        seeds = [SEED_DICE_BAG, mint.key().as_ref()],
        bump,
    )]
    pub dice_bag: Account<'info, DiceBag>,

    /// CHECK: Treasury receives mint price, validated against config
    #[account(mut, address = config.treasury)]
    pub treasury: AccountInfo<'info>,

    /// CHECK: Metaplex Core program
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_mint_dice_bag(context: Context<MintDiceBagAccountConstraints>) -> Result<()> {
    require!(!context.accounts.config.is_paused, DiceDuelError::GamePaused);

    // Transfer mint price to treasury
    system_program::transfer(
        CpiContext::new(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.player.to_account_info(),
                to: context.accounts.treasury.to_account_info(),
            },
        ),
        context.accounts.config.mint_price,
    )?;

    // Create Metaplex Core NFT with PermanentFreezeDelegate (soulbound)
    CreateV2CpiBuilder::new(&context.accounts.mpl_core_program)
        .asset(&context.accounts.mint)
        .payer(&context.accounts.player)
        .owner(Some(&context.accounts.player))
        .system_program(&context.accounts.system_program)
        .name("Bag of Dice".to_string())
        .uri("".to_string())
        .plugins(vec![
            mpl_core::types::PluginAuthorityPair {
                plugin: Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: true }),
                authority: Some(PluginAuthority::UpdateAuthority),
            },
        ])
        .invoke()?;

    // Init DiceBag PDA
    let dice_bag = &mut context.accounts.dice_bag;
    dice_bag.mint = context.accounts.mint.key();
    dice_bag.owner = context.accounts.player.key();
    dice_bag.uses_remaining = context.accounts.config.initial_uses;
    dice_bag.total_games = 0;
    dice_bag.wins = 0;
    dice_bag.losses = 0;
    dice_bag.bump = context.bumps.dice_bag;

    emit!(DiceBagMinted {
        player: context.accounts.player.key(),
        mint: context.accounts.mint.key(),
        uses: context.accounts.config.initial_uses,
    });

    Ok(())
}
