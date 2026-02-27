use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DiceDuelError;
use crate::state::{Wager, WagerStatus};

/// Minimal VRF callback that only stores the randomness result
/// This reduces the number of accounts to avoid oracle transaction size limits
#[derive(Accounts)]
pub struct ConsumeRandomnessMinimalAccountConstraints<'info> {
    /// SECURITY: Validates callback is from the real VRF program.
    /// In test builds, any signer is accepted to enable integration testing
    /// of the settlement path without a real VRF oracle.
    #[cfg_attr(
        not(feature = "test-mode"),
        account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)
    )]
    pub vrf_program_identity: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_WAGER, wager.challenger.as_ref()],
        bump = wager.bump,
        constraint = wager.status == WagerStatus::Active @ DiceDuelError::InvalidWagerStatus,
    )]
    pub wager: Account<'info, Wager>,
}

pub fn handle_consume_randomness_minimal(
    context: Context<ConsumeRandomnessMinimalAccountConstraints>,
    randomness: [u8; 32],
) -> Result<()> {
    let wager = &mut context.accounts.wager;

    // Compute VRF result
    let result = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 0, 99);

    // Store the result and mark as ready for settlement
    wager.vrf_result = Some(result);
    wager.status = WagerStatus::ReadyToSettle;

    let clock = Clock::get()?;
    wager.vrf_fulfilled_at = Some(clock.unix_timestamp);

    msg!("VRF callback completed - result: {}, ready for settlement", result);

    Ok(())
}