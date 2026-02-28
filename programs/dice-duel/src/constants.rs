pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_PENDING_ADMIN: &[u8] = b"pending_admin";
pub const SEED_DICE_BAG: &[u8] = b"dice_bag";
pub const SEED_WAGER: &[u8] = b"wager";
pub const SEED_ESCROW: &[u8] = b"escrow";
pub const SEED_STATS: &[u8] = b"stats";
pub const SEED_GAME_TYPE: &[u8] = b"game_type";

pub const MAX_FEE_BPS: u16 = 10_000;
pub const HIGH_LOW_GAME_TYPE: u8 = 0;
pub const CHOICE_LOW: u8 = 0;
pub const CHOICE_HIGH: u8 = 1;
pub const HIGH_LOW_THRESHOLD: u8 = 50;
pub const DEFAULT_PAYOUT_MULTIPLIER_BPS: u32 = 10_000;
