/**
 * Dice Duel Audio Constants — copied as-is (no internal imports)
 */

export const DICE_DUEL_AUDIO = {
	CHALLENGE: "dice_duel_challenge",
	ROLL: "dice_duel_roll",
	LAND: "dice_duel_land",
	WIN: "dice_duel_win",
	LOSE: "dice_duel_lose",
	COIN: "dice_duel_coin",
	CLICK: "dice_duel_click",
} as const;

export const DICE_DUEL_AUDIO_PATHS: Record<string, string> = {
	[DICE_DUEL_AUDIO.CHALLENGE]:
		"/assets/features/dice-duel/dice_duel_challenge.wav",
	[DICE_DUEL_AUDIO.ROLL]: "/assets/features/dice-duel/dice_duel_roll.wav",
	[DICE_DUEL_AUDIO.LAND]: "/assets/features/dice-duel/dice_duel_land.wav",
	[DICE_DUEL_AUDIO.WIN]: "/assets/features/dice-duel/dice_duel_win.wav",
	[DICE_DUEL_AUDIO.LOSE]: "/assets/features/dice-duel/dice_duel_lose.wav",
	[DICE_DUEL_AUDIO.COIN]: "/assets/features/dice-duel/dice_duel_coin.wav",
	[DICE_DUEL_AUDIO.CLICK]:
		"/assets/features/dice-duel/dice_duel_click.wav",
};

export type DiceDuelAudioKey =
	(typeof DICE_DUEL_AUDIO)[keyof typeof DICE_DUEL_AUDIO];
