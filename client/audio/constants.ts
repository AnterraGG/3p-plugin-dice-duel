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
		"/assets/features/dragon-dice/dragon_dice_challenge.wav",
	[DICE_DUEL_AUDIO.ROLL]: "/assets/features/dragon-dice/dragon_dice_roll.wav",
	[DICE_DUEL_AUDIO.LAND]: "/assets/features/dragon-dice/dragon_dice_land.wav",
	[DICE_DUEL_AUDIO.WIN]: "/assets/features/dragon-dice/dragon_dice_win.wav",
	[DICE_DUEL_AUDIO.LOSE]: "/assets/features/dragon-dice/dragon_dice_lose.wav",
	[DICE_DUEL_AUDIO.COIN]: "/assets/features/dragon-dice/dragon_dice_coin.wav",
	[DICE_DUEL_AUDIO.CLICK]:
		"/assets/features/dragon-dice/dragon_dice_click.wav",
};

export type DiceDuelAudioKey =
	(typeof DICE_DUEL_AUDIO)[keyof typeof DICE_DUEL_AUDIO];
