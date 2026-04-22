/**
 * Dice Duel Asset Declarations
 *
 * Single source of truth for all plugin-owned assets.
 * Framework auto-loads these before onLoad() runs.
 */

import { definePluginAssets } from "@anterra/3p-plugin-sdk/client";

export const assets = definePluginAssets({
	audio: {
		challenge: "dragon_dice_challenge.wav",
		roll: "dragon_dice_roll.wav",
		land: "dragon_dice_land.wav",
		win: "dragon_dice_win.wav",
		lose: "dragon_dice_lose.wav",
		coin: "dragon_dice_coin.wav",
		click: "dragon_dice_click.wav",
	},
	textures: {
		face1: "dice_1.png",
		face2: "dice_2.png",
		face3: "dice_3.png",
		face4: "dice_4.png",
		face5: "dice_5.png",
		face6: "dice_6.png",
		blank: "dice_blank.png",
		challenge: "challenge_icon.png",
	},
});

/** Number of dice faces */
export const DICE_FACE_COUNT = 6;

/**
 * Get texture handle for a dice face value (1-6).
 * Returns the branded handle for use with ctx.render.createSprite().
 */
export function getDiceFaceHandle(value: number) {
	const handles = [
		assets.textures.face1,
		assets.textures.face2,
		assets.textures.face3,
		assets.textures.face4,
		assets.textures.face5,
		assets.textures.face6,
	];
	return handles[Math.max(0, Math.min(value - 1, 5))];
}
