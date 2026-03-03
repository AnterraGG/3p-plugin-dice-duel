/**
 * Dice Duel Shared Constants
 */

// ==========================================
// Token Constants
// ==========================================

export const SUPPORTED_TOKENS = {
	SOL: {
		symbol: "SOL",
		name: "Solana",
		decimals: 9,
	},
} as const;

export type SupportedTokenSymbol = keyof typeof SUPPORTED_TOKENS;

// Render depths (higher = on top)
export const DICE_DUEL_DEPTHS = {
	CHALLENGE_INDICATOR: 4000,
	DICE_ROLL: 4010,
	CELEBRATION: 4020,
} as const;

// Animation durations (ms)
export const DICE_DUEL_ANIMATION = {
	DICE_ROLL_DURATION: 3250,
	DICE_LAND_PAUSE: 1200,
	/** Delay after dice land before celebration text appears */
	CELEBRATION_DELAY: 800,
	CELEBRATION_DURATION: 5000,
	CELEBRATION_HOLD: 2500, // fully visible before fade begins
	CHALLENGE_PULSE_SPEED: 400,
	FADE_OUT_DURATION: 800,
	BALANCE_FLOAT_DURATION: 5500,
	BALANCE_FLOAT_HOLD: 2000, // fully visible before fade begins
} as const;

// Sprite scales
export const DICE_DUEL_SCALES = {
	DICE: 3.0,
	CHALLENGE_INDICATOR: 2.0,
	CONFETTI: 1.0,
} as const;

// Dice face sprite configuration
export const DICE_TEXTURE_PREFIX = "dice-duel-face-";
export const DICE_FACE_COUNT = 6;

// Challenge indicator sprite
export const CHALLENGE_TEXTURE_KEY = "dice-duel-challenge-icon";
export const CHALLENGE_TEXTURE_PATH =
	"/assets/features/dragon-dice/challenge_icon.png";

// Dice face texture paths
export const DICE_TEXTURE_PATHS: Record<string, string> = {
	[`${DICE_TEXTURE_PREFIX}1`]: "/assets/features/dragon-dice/dice_1.png",
	[`${DICE_TEXTURE_PREFIX}2`]: "/assets/features/dragon-dice/dice_2.png",
	[`${DICE_TEXTURE_PREFIX}3`]: "/assets/features/dragon-dice/dice_3.png",
	[`${DICE_TEXTURE_PREFIX}4`]: "/assets/features/dragon-dice/dice_4.png",
	[`${DICE_TEXTURE_PREFIX}5`]: "/assets/features/dragon-dice/dice_5.png",
	[`${DICE_TEXTURE_PREFIX}6`]: "/assets/features/dragon-dice/dice_6.png",
};
