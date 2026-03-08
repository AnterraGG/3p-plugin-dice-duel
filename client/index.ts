/**
 * Dice Duel Client Plugin — Entry Point (3p SDK version)
 *
 * Key changes from internal:
 * - defineClientPlugin from 3p-plugin-sdk/client instead of plugin-sdk/client
 * - ctx.services.audio instead of ctx.worldContext.services.audio
 */

import type { PluginUIEntry } from "@townexchange/3p-plugin-sdk/client";
import { defineClientPlugin } from "@townexchange/3p-plugin-sdk/client";
import { getTokenTextures } from "@townexchange/token-icons";
import { assets } from "../shared/assets";
import { diceDuelChains } from "../shared/chains";
import { manifest as diceDuelManifest } from "../shared/manifest";
import { registerDiceDuelNotificationHandler } from "./handlers";
import { DiceDuelModule } from "./modules/DiceDuelModule";
import { DiceDuelUIContainer } from "./ui";
import {
	DD_INCOMING_WAGER,
	DD_INITIATE_WAGER,
	DD_INVENTORY,
	DD_SHOP,
	DD_WAGER_DETAILS,
	DD_WAGER_HISTORY,
} from "./window-keys";

// ============================================================================
// Plugin Definition
// ============================================================================

const ui: PluginUIEntry[] = [
	// Slot — always rendered in game HUD
	{
		type: "slot",
		id: "dice-duel-hud",
		slot: "game-hud",
		component: DiceDuelUIContainer,
		priority: 90, // Below BombaPerp (100)
	},
	// Windows — on-demand, managed by WindowManager
	{
		type: "window",
		key: DD_SHOP,
		component: () => import("./ui/svm/SvmShop/SvmShopContent"),
		inputMode: "blocking",
	},
	{
		type: "window",
		key: DD_INVENTORY,
		component: () => import("./ui/svm/SvmInventory/SvmInventoryContent"),
	},
	{
		type: "window",
		key: DD_INITIATE_WAGER,
		component: () => import("./ui/svm/SvmWager/InitiateWagerContent"),
	},
	{
		type: "window",
		key: DD_INCOMING_WAGER,
		component: () => import("./ui/svm/SvmWager/AcceptWagerContent"),
	},
	{
		type: "window",
		key: DD_WAGER_DETAILS,
		component: () => import("./ui/svm/SvmWager/SvmWagerDetailsContent"),
	},
	{
		type: "window",
		key: DD_WAGER_HISTORY,
		component: () => import("./ui/svm/SvmWager/SvmWagerHistoryContent"),
	},
];

export const DiceDuelClientPlugin = defineClientPlugin({
	name: "Dice Duel",
	version: "1.0.0",
	sdkVersion: "1.0.0",
	modules: [DiceDuelModule], // ECS module for visual effects
	ui,
	capabilities: ["rendering", "network"],
	chains: diceDuelChains,
	manifest: diceDuelManifest,
	assets,
	onLoad: async (ctx) => {
		// Register notification packet handler.
		registerDiceDuelNotificationHandler(ctx);

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

