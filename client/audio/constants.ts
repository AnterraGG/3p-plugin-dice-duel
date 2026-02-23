/**
 * Dragon Dice Audio Constants — copied as-is (no internal imports)
 */

export const DRAGON_DICE_AUDIO = {
	CHALLENGE: "dragon_dice_challenge",
	ROLL: "dragon_dice_roll",
	LAND: "dragon_dice_land",
	WIN: "dragon_dice_win",
	LOSE: "dragon_dice_lose",
	COIN: "dragon_dice_coin",
	CLICK: "dragon_dice_click",
} as const;

export const DRAGON_DICE_AUDIO_PATHS: Record<string, string> = {
	[DRAGON_DICE_AUDIO.CHALLENGE]:
		"/assets/features/dragon-dice/dragon_dice_challenge.wav",
	[DRAGON_DICE_AUDIO.ROLL]: "/assets/features/dragon-dice/dragon_dice_roll.wav",
	[DRAGON_DICE_AUDIO.LAND]: "/assets/features/dragon-dice/dragon_dice_land.wav",
	[DRAGON_DICE_AUDIO.WIN]: "/assets/features/dragon-dice/dragon_dice_win.wav",
	[DRAGON_DICE_AUDIO.LOSE]: "/assets/features/dragon-dice/dragon_dice_lose.wav",
	[DRAGON_DICE_AUDIO.COIN]: "/assets/features/dragon-dice/dragon_dice_coin.wav",
	[DRAGON_DICE_AUDIO.CLICK]:
		"/assets/features/dragon-dice/dragon_dice_click.wav",
};

export type DragonDiceAudioKey =
	(typeof DRAGON_DICE_AUDIO)[keyof typeof DRAGON_DICE_AUDIO];
