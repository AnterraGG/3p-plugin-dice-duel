use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("7xfkbzEMJ31jPUqZoJ3EXrU72LiAw1wGKupGqmdZdoMM");

#[program]
pub mod dice_duel {
    use super::*;

    pub fn initialize(
        context: Context<InitializeAccountConstraints>,
        treasury: Pubkey,
        fee_bps: u16,
        mint_price: u64,
        initial_uses: u8,
        wager_expiry_seconds: i64,
        vrf_timeout_seconds: i64,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(
            context,
            treasury,
            fee_bps,
            mint_price,
            initial_uses,
            wager_expiry_seconds,
            vrf_timeout_seconds,
        )
    }

    pub fn mint_dice_bag(context: Context<MintDiceBagAccountConstraints>) -> Result<()> {
        instructions::mint_dice_bag::handle_mint_dice_bag(context)
    }

    pub fn initiate_wager(
        context: Context<InitiateWagerAccountConstraints>,
        opponent: Pubkey,
        amount: u64,
        game_type: u8,
        challenger_choice: u8,
    ) -> Result<()> {
        instructions::initiate_wager::handle_initiate_wager(
            context,
            opponent,
            amount,
            game_type,
            challenger_choice,
        )
    }

    pub fn cancel_wager(context: Context<CancelWagerAccountConstraints>) -> Result<()> {
        instructions::cancel_wager::handle_cancel_wager(context)
    }

    pub fn accept_wager(context: Context<AcceptWagerAccountConstraints>) -> Result<()> {
        instructions::accept_wager::handle_accept_wager(context)
    }

    pub fn consume_randomness(
        context: Context<ConsumeRandomnessAccountConstraints>,
        randomness: [u8; 32],
    ) -> Result<()> {
        instructions::consume_randomness::handle_consume_randomness(context, randomness)
    }

    pub fn consume_randomness_minimal(
        context: Context<ConsumeRandomnessMinimalAccountConstraints>,
        randomness: [u8; 32],
    ) -> Result<()> {
        instructions::consume_randomness_minimal::handle_consume_randomness_minimal(context, randomness)
    }

    pub fn consume_randomness_resolved(
        context: Context<ConsumeRandomnessResolvedAccountConstraints>,
        randomness: [u8; 32],
    ) -> Result<()> {
        instructions::consume_randomness_resolved::handle_consume_randomness_resolved(context, randomness)
    }

    pub fn claim_winnings(context: Context<ClaimWinningsAccountConstraints>) -> Result<()> {
        instructions::claim_winnings::handle_claim_winnings(context)
    }

    pub fn settle_wager(context: Context<SettleWagerAccountConstraints>) -> Result<()> {
        instructions::settle_wager::handle_settle_wager(context)
    }

    pub fn claim_vrf_timeout(context: Context<ClaimVrfTimeoutAccountConstraints>) -> Result<()> {
        instructions::claim_vrf_timeout::handle_claim_vrf_timeout(context)
    }

    pub fn claim_expired(context: Context<ClaimExpiredAccountConstraints>) -> Result<()> {
        instructions::claim_expired::handle_claim_expired(context)
    }

    pub fn cleanup_stale_wager(context: Context<CleanupStaleWagerAccountConstraints>) -> Result<()> {
        instructions::cleanup_stale_wager::handle_cleanup_stale_wager(context)
    }

    pub fn update_config(
        context: Context<UpdateConfigAccountConstraints>,
        treasury: Option<Pubkey>,
        fee_bps: Option<u16>,
        mint_price: Option<u64>,
        initial_uses: Option<u8>,
        wager_expiry_seconds: Option<i64>,
        vrf_timeout_seconds: Option<i64>,
    ) -> Result<()> {
        instructions::admin::update_config::handle_update_config(
            context,
            treasury,
            fee_bps,
            mint_price,
            initial_uses,
            wager_expiry_seconds,
            vrf_timeout_seconds,
        )
    }

    pub fn pause(context: Context<PauseAccountConstraints>) -> Result<()> {
        instructions::admin::pause::handle_pause(context)
    }

    pub fn unpause(context: Context<PauseAccountConstraints>) -> Result<()> {
        instructions::admin::pause::handle_unpause(context)
    }

    pub fn register_game_type(
        context: Context<RegisterGameTypeAccountConstraints>,
        id: u8,
        name: String,
        enabled: bool,
    ) -> Result<()> {
        instructions::admin::register_game_type::handle_register_game_type(
            context, id, name, enabled,
        )
    }

    pub fn update_game_type(
        context: Context<UpdateGameTypeAccountConstraints>,
        name: Option<String>,
        enabled: Option<bool>,
    ) -> Result<()> {
        instructions::admin::update_game_type::handle_update_game_type(context, name, enabled)
    }
}
