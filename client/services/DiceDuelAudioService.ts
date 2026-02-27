/**
 * Dice Duel Audio Service (3p SDK version)
 *
 * Import change: IAudioService from 3p-plugin-sdk/client
 */

import type { IAudioService } from "@townexchange/3p-plugin-sdk/client";
import { DICE_DUEL_AUDIO, DICE_DUEL_AUDIO_PATHS } from "../audio/constants";

let audioService: IAudioService | null = null;
let audioInitialized = false;

export async function initDiceDuelAudio(audio: IAudioService): Promise<void> {
	if (audioInitialized) return;

	audioService = audio;
	if (!audioService) return;

	try {
		const loadPromises: Promise<void>[] = [];
		for (const [key, path] of Object.entries(DICE_DUEL_AUDIO_PATHS)) {
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

export function playDiceDuelSound(key: string): void {
	if (!audioService) return;
	try {
		audioService.playDynamicSound(key, { volume: 0.6 });
	} catch {
		// Ignore
	}
}

export function playChallengeSound(): void {
	playDiceDuelSound(DICE_DUEL_AUDIO.CHALLENGE);
}

export function playRollSound(): void {
	playDiceDuelSound(DICE_DUEL_AUDIO.ROLL);
}

export function playLandSound(): void {
	playDiceDuelSound(DICE_DUEL_AUDIO.LAND);
}

export function playWinSound(): void {
	playDiceDuelSound(DICE_DUEL_AUDIO.WIN);
}

export function playLoseSound(): void {
	playDiceDuelSound(DICE_DUEL_AUDIO.LOSE);
}

export function playCoinSound(): void {
	playDiceDuelSound(DICE_DUEL_AUDIO.COIN);
}

export function playClickSound(): void {
	playDiceDuelSound(DICE_DUEL_AUDIO.CLICK);
}

export function playErrorSound(): void {
	playDiceDuelSound(DICE_DUEL_AUDIO.LOSE);
}

export function destroyDiceDuelAudio(): void {
	if (!audioService) return;
	for (const key of Object.values(DICE_DUEL_AUDIO)) {
		audioService.unloadDynamicSound(key);
	}
	audioService = null;
	audioInitialized = false;
}
