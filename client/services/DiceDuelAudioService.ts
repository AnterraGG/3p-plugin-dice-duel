/**
 * Dice Duel Audio — thin accessor for UI components.
 *
 * Delegates to the framework-managed PluginAudioService via asset handles.
 * Assets are auto-loaded by the framework; this just provides named helpers
 * so UI components can call `playChallengeSound()` without ECS context.
 */

import type { IPluginAudioService } from "@townexchange/3p-plugin-sdk/client";
import { assets } from "../../shared/assets";

let audioService: IPluginAudioService | null = null;

/** Called from onLoad to store the framework audio service reference. */
export function setDiceDuelAudio(audio: IPluginAudioService): void {
	audioService = audio;
}

function play(handle: Parameters<IPluginAudioService["play"]>[0]): void {
	audioService?.play(handle);
}

export function playChallengeSound(): void {
	play(assets.audio.challenge);
}

export function playRollSound(): void {
	play(assets.audio.roll);
}

export function playLandSound(): void {
	play(assets.audio.land);
}

export function playWinSound(): void {
	play(assets.audio.win);
}

export function playLoseSound(): void {
	play(assets.audio.lose);
}

export function playCoinSound(): void {
	play(assets.audio.coin);
}

export function playClickSound(): void {
	play(assets.audio.click);
}

export function playErrorSound(): void {
	play(assets.audio.lose);
}
