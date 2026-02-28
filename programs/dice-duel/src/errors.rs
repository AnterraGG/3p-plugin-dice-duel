use anchor_lang::prelude::*;

#[error_code]
pub enum DiceDuelError {
    #[msg("Game is currently paused")]
    GamePaused,
    #[msg("Cannot wager against yourself")]
    SelfWager,
    #[msg("Dice bag has no uses remaining")]
    BagExhausted,
    #[msg("Dice bag not owned by challenger")]
    BagNotOwned,
    #[msg("Invalid wager amount")]
    InvalidAmount,
    #[msg("Game type is disabled")]
    GameTypeDisabled,
    #[msg("Invalid choice for this game type")]
    InvalidChoice,
    #[msg("An active wager is in progress — cannot overwrite")]
    WagerInProgress,
    #[msg("Wager is not in the expected status")]
    InvalidWagerStatus,
    #[msg("Wager has expired")]
    WagerExpired,
    #[msg("Wager has not expired yet")]
    WagerNotExpired,
    #[msg("VRF timeout has not been reached")]
    VrfNotTimedOut,
    #[msg("Escrow balance mismatch")]
    EscrowBalanceMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Fee basis points exceed maximum (10000)")]
    FeeTooHigh,
    #[msg("Initial uses must be greater than zero")]
    InvalidInitialUses,
    #[msg("VRF timeout must exceed wager expiry")]
    InvalidTimeoutConfig,
    #[msg("Unauthorized — admin only")]
    Unauthorized,
    #[msg("Duplicate accounts — challenger and opponent must differ")]
    DuplicateAccounts,
    #[msg("Invalid game type name length")]
    InvalidGameTypeName,
    #[msg("VRF result is not available yet")]
    VrfResultNotAvailable,
    #[msg("Wager is stale — challenger has created a newer wager")]
    WagerStale,
    #[msg("Previous pending wager must be cleaned up before creating a new one")]
    PreviousWagerRequired,
    #[msg("Previous wager nonce does not match pending_nonce — wrong wager passed")]
    WagerNonceMismatch,
    #[msg("Signer is not the pending admin")]
    NotPendingAdmin,
}
