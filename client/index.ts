/**
 * Dragon Dice Client Plugin — Entry Point (3p SDK version)
 *
 * Key changes from internal:
 * - defineClientPlugin from 3p-plugin-sdk/client instead of plugin-sdk/client
 * - ctx.services.audio instead of ctx.worldContext.services.audio
 */

import { defineClientPlugin } from "@townexchange/3p-plugin-sdk/client";
import { getTokenTextures } from "@townexchange/token-icons";
import { dragonDiceChains } from "../shared/chains";
import {
	CHALLENGE_TEXTURE_KEY,
	CHALLENGE_TEXTURE_PATH,
	DICE_TEXTURE_PATHS,
} from "../shared/constants";
import { manifest as dragonDiceManifest } from "../shared/manifest";
import { registerDragonDiceNotificationHandler } from "./handlers";
import { DragonDiceModule } from "./modules/DragonDiceModule";
import { registerDragonDiceWindows } from "./register-windows";
import { initDragonDiceAudio } from "./services/DragonDiceAudioService";
import { DragonDiceUIContainer } from "./ui";

// ============================================================================
// Plugin Definition
// ============================================================================

export const DragonDiceClientPlugin = defineClientPlugin({
	id: "dragon-dice",
	name: "Dragon Dice",
	version: "1.0.0",
	sdkVersion: "1.0.0",
	modules: [DragonDiceModule], // ECS module for visual effects
	ui: [
		{
			id: "dragon-dice-hud",
			slot: "game-hud",
			component: DragonDiceUIContainer,
			priority: 90, // Below BombaPerp (100)
		},
	],
	capabilities: ["rendering", "network"],
	chains: dragonDiceChains,
	manifest: dragonDiceManifest,
	onLoad: async (ctx) => {
		// Register all windows with the window manager
		registerDragonDiceWindows();

		// Register notification packet handler.
		// Query invalidation on incoming notifications is handled here via ctx.queries,
		// which the bridge wires to the app's QueryClient singleton.
		registerDragonDiceNotificationHandler(ctx);

		// Initialize audio (async, non-blocking)
		const audio = ctx.services.audio;
		if (audio) {
			initDragonDiceAudio(audio).catch((err) => {
				console.warn("[DragonDice] Audio init failed (non-fatal):", err);
			});
		}

		// Preload all plugin textures (non-blocking).
		// Systems use hasTexture() guards so they gracefully wait for loading.
		const render = ctx.services.render;
		const textureLoads: Promise<void>[] = [];

		for (const [key, path] of Object.entries(DICE_TEXTURE_PATHS)) {
			if (!render.hasTexture(key)) {
				textureLoads.push(render.loadImage(key, path));
			}
		}
		for (const { key, url } of getTokenTextures()) {
			if (!render.hasTexture(key)) {
				textureLoads.push(render.loadImage(key, url));
			}
		}
		if (!render.hasTexture(CHALLENGE_TEXTURE_KEY)) {
			textureLoads.push(
				render.loadImage(CHALLENGE_TEXTURE_KEY, CHALLENGE_TEXTURE_PATH),
			);
		}

		if (textureLoads.length > 0) {
			Promise.all(textureLoads).catch((err) => {
				console.warn("[DragonDice] Texture preload failed (non-fatal):", err);
			});
		}
	},
});

// ============================================================================
// Re-exports for external use
// ============================================================================

// ─── Hooks ─────────────────────────────────────────────────────────────────

export {
	useSvmInventoryWagers,
	useSvmWagerHistory,
	useSvmWagerDetail,
	useSvmDiceBags,
	useSvmPlayerStats,
	useSvmGameConfig,
	usePriorityFees,
	queryKeys,
	decodeDiceDuelError,
	logDiceDuelError,
} from "./hooks";
export type { DecodedAnchorError } from "./hooks";

// ─── UI Components ─────────────────────────────────────────────────────────

export { DragonDiceUIContainer } from "./ui";
export { SvmShop } from "./ui";
export {
	SvmInventory,
	SvmDiceBagSlot,
	SvmWagerSlot,
	SvmHistoryItem,
} from "./ui";
// ─── Window Keys ───────────────────────────────────────────────────────────

export {
	DD_SHOP,
	DD_INVENTORY,
	DD_INITIATE_WAGER,
	DD_INCOMING_WAGER,
	DD_WAGER_DETAILS,
	DD_WAGER_HISTORY,
} from "./window-keys";

// ─── Window Registration ───────────────────────────────────────────────────

export { registerDragonDiceWindows } from "./register-windows";

// ─── Handlers ────────────────────────────────────────────────────────────────

export { registerDragonDiceNotificationHandler } from "./handlers";

// ─── Store ──────────────────────────────────────────────────────────────────

export {
	useDragonDiceNotificationStore,
	type DragonDiceNotification,
	useDragonDiceGameStore,
	type DiceRollAnimation,
	type CelebrationEffect,
	type ChallengeIndicator,
} from "./store";

// ─── Modules ────────────────────────────────────────────────────────────────

export { DragonDiceModule } from "./modules";

// ─── Audio ──────────────────────────────────────────────────────────────────

export {
	initDragonDiceAudio,
	playClickSound,
	playErrorSound,
	playChallengeSound,
	playRollSound,
	playLandSound,
	playWinSound,
	playLoseSound,
	playCoinSound,
} from "./services/DragonDiceAudioService";

// ─── API ───────────────────────────────────────────────────────────────────

export {
	fetchInventoryWagers,
	fetchWagerHistory,
	fetchWagerDetail,
	fetchSvmDiceBags,
	fetchSvmPlayerStats,
	fetchSvmGameConfig,
} from "./api";

