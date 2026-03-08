/**
 * Dice Duel Client Plugin — Entry Point (3p SDK version)
 *
 * Key changes from internal:
 * - defineClientPlugin from 3p-plugin-sdk/client instead of plugin-sdk/client
 * - ctx.services.audio instead of ctx.worldContext.services.audio
 */

import { defineClientPlugin } from "@townexchange/3p-plugin-sdk/client";
import { getTokenTextures } from "@townexchange/token-icons";
import { assets } from "../shared/assets";
import { diceDuelChains } from "../shared/chains";
import { manifest as diceDuelManifest } from "../shared/manifest";
import { registerDiceDuelNotificationHandler } from "./handlers";
import { DiceDuelModule } from "./modules/DiceDuelModule";
import { registerDiceDuelWindows } from "./register-windows";
import { setDiceDuelAudio } from "./services/DiceDuelAudioService";
import { DiceDuelUIContainer } from "./ui";

// ============================================================================
// Plugin Definition
// ============================================================================

export const DiceDuelClientPlugin = defineClientPlugin({
	id: "dice-duel",
	name: "Dice Duel",
	version: "1.0.0",
	sdkVersion: "1.0.0",
	modules: [DiceDuelModule], // ECS module for visual effects
	ui: [
		{
			id: "dice-duel-hud",
			slot: "game-hud",
			component: DiceDuelUIContainer,
			priority: 90, // Below BombaPerp (100)
		},
	],
	capabilities: ["rendering", "network"],
	chains: diceDuelChains,
	manifest: diceDuelManifest,
	assets,
	onLoad: async (ctx) => {
		// Register all windows with the window manager
		registerDiceDuelWindows();

		// Register notification packet handler.
		registerDiceDuelNotificationHandler(ctx);

		// Store framework audio service reference for UI components
		if (ctx.audio) setDiceDuelAudio(ctx.audio);

		// Plugin audio + textures are auto-loaded by framework via assets declaration.
		// Only token textures (external, dynamic) still need manual loading.
		const render = ctx.services.render;
		const textureLoads: Promise<void>[] = [];
		for (const { key, url } of getTokenTextures()) {
			if (!render.hasTexture(key)) {
				textureLoads.push(render.loadImage(key, url));
			}
		}
		if (textureLoads.length > 0) {
			Promise.all(textureLoads).catch((err) => {
				console.warn("[DiceDuel] Token texture preload failed (non-fatal):", err);
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

export { DiceDuelUIContainer } from "./ui";
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

export { registerDiceDuelWindows } from "./register-windows";

// ─── Handlers ────────────────────────────────────────────────────────────────

export { registerDiceDuelNotificationHandler } from "./handlers";

// ─── Store ──────────────────────────────────────────────────────────────────

export {
	useDiceDuelNotificationStore,
	type DiceDuelNotification,
	useDiceDuelGameStore,
	type DiceRollAnimation,
	type CelebrationEffect,
	type ChallengeIndicator,
} from "./store";

// ─── Modules ────────────────────────────────────────────────────────────────

export { DiceDuelModule } from "./modules";

// ─── Assets ─────────────────────────────────────────────────────────────────

export { assets, getDiceFaceHandle, DICE_FACE_COUNT } from "../shared/assets";

// ─── API ───────────────────────────────────────────────────────────────────

export {
	fetchInventoryWagers,
	fetchWagerHistory,
	fetchWagerDetail,
	fetchSvmDiceBags,
	fetchSvmPlayerStats,
	fetchSvmGameConfig,
} from "./api";

