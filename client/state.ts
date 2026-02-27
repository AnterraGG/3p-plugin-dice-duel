/**
 * Dice Duel Module State (3p SDK version)
 *
 * Tracks sprites, graphics, cleanup callbacks, and local player position.
 * Import change: ISprite/IGraphics/IText from 3p-plugin-sdk/client
 */

import type {
	IGraphics,
	ISprite,
	IText,
} from "@townexchange/3p-plugin-sdk/client";

interface DiceDuelModuleState {
	sprites: Set<ISprite>;
	graphics: Set<IGraphics>;
	texts: Set<IText>;
	cleanupCallbacks: Set<() => void>;
}

const state: DiceDuelModuleState = {
	sprites: new Set(),
	graphics: new Set(),
	texts: new Set(),
	cleanupCallbacks: new Set(),
};

// ─── Local Player Position (updated by ECS systems, read by UI) ──────────

let _localPlayerPosition: { x: number; y: number } | null = null;
let _localPlayerEntityId: number | null = null;

export function setLocalPlayerPosition(
	pos: { x: number; y: number } | null,
): void {
	_localPlayerPosition = pos;
}

export function getLocalPlayerPosition(): { x: number; y: number } | null {
	return _localPlayerPosition;
}

export function setLocalPlayerEntityId(eid: number | null): void {
	_localPlayerEntityId = eid;
}

export function getLocalPlayerEntityId(): number | null {
	return _localPlayerEntityId;
}

// ─── Sprite Management ─────────────────────────────────────────────────────

export function registerSprite(sprite: ISprite): void {
	state.sprites.add(sprite);
}

export function unregisterSprite(sprite: ISprite): void {
	state.sprites.delete(sprite);
}

// ─── Graphics Management ───────────────────────────────────────────────────

export function registerGraphics(graphics: IGraphics): void {
	state.graphics.add(graphics);
}

export function unregisterGraphics(graphics: IGraphics): void {
	state.graphics.delete(graphics);
}

// ─── Text Management ───────────────────────────────────────────────────────

export function registerText(text: IText): void {
	state.texts.add(text);
}

export function unregisterText(text: IText): void {
	state.texts.delete(text);
}

// ─── Cleanup Callbacks ─────────────────────────────────────────────────────

export function registerCleanupCallback(callback: () => void): void {
	state.cleanupCallbacks.add(callback);
}

// ─── Full Cleanup ──────────────────────────────────────────────────────────

export function clearDiceDuelVisuals(): void {
	console.log("[DiceDuel] Clearing all visuals...");

	for (const sprite of state.sprites) {
		try {
			sprite.destroy();
		} catch (_e) {
			// Ignore - sprite may already be destroyed
		}
	}
	state.sprites.clear();

	for (const graphics of state.graphics) {
		try {
			graphics.destroy();
		} catch (_e) {
			// Ignore
		}
	}
	state.graphics.clear();

	for (const text of state.texts) {
		try {
			text.destroy();
		} catch (_e) {
			// Ignore
		}
	}
	state.texts.clear();

	for (const callback of state.cleanupCallbacks) {
		try {
			callback();
		} catch (e) {
			console.warn("[DiceDuel] Cleanup callback error:", e);
		}
	}
	state.cleanupCallbacks.clear();

	_localPlayerPosition = null;
	_localPlayerEntityId = null;

	console.log("[DiceDuel] All visuals cleared");
}
