/**
 * Dragon Dice Audio Service (3p SDK version)
 *
 * Import change: IAudioService from 3p-plugin-sdk/client
 */

import type { IAudioService } from "@townexchange/3p-plugin-sdk/client";
import { DRAGON_DICE_AUDIO, DRAGON_DICE_AUDIO_PATHS } from "../audio/constants";

let audioService: IAudioService | null = null;
let audioInitialized = false;

export async function initDragonDiceAudio(audio: IAudioService): Promise<void> {
	if (audioInitialized) return;

	audioService = audio;
	if (!audioService) return;

	try {
		const loadPromises: Promise<void>[] = [];
		for (const [key, path] of Object.entries(DRAGON_DICE_AUDIO_PATHS)) {
			loadPromises.push(
				audioService
					.loadDynamicSound(key, path, { volume: 0.5 })
					.catch(() => {}),
			);
		}
		await Promise.all(loadPromises);
		audioInitialized = true;
	} catch {
		// Audio is optional
	}
}

export function playDragonDiceSound(key: string): void {
	if (!audioService) return;
	try {
		audioService.playDynamicSound(key, { volume: 0.6 });
	} catch {
		// Ignore
	}
}

export function playChallengeSound(): void {
	playDragonDiceSound(DRAGON_DICE_AUDIO.CHALLENGE);
}

export function playRollSound(): void {
	playDragonDiceSound(DRAGON_DICE_AUDIO.ROLL);
}

export function playLandSound(): void {
	playDragonDiceSound(DRAGON_DICE_AUDIO.LAND);
}

export function playWinSound(): void {
	playDragonDiceSound(DRAGON_DICE_AUDIO.WIN);
}

export function playLoseSound(): void {
	playDragonDiceSound(DRAGON_DICE_AUDIO.LOSE);
}

export function playCoinSound(): void {
	playDragonDiceSound(DRAGON_DICE_AUDIO.COIN);
}

export function playClickSound(): void {
	playDragonDiceSound(DRAGON_DICE_AUDIO.CLICK);
}

export function playErrorSound(): void {
	playDragonDiceSound(DRAGON_DICE_AUDIO.LOSE);
}

export function destroyDragonDiceAudio(): void {
	if (!audioService) return;
	for (const key of Object.values(DRAGON_DICE_AUDIO)) {
		audioService.unloadDynamicSound(key);
	}
	audioService = null;
	audioInitialized = false;
}
