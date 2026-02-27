/**
 * Dice Duel Window Registration (3p SDK version)
 *
 * Uses tex-ui-kit (allowed dependency) for window registration.
 * Window keys are plain strings (no @tex/window-keys type-safe registry).
 *
 * All windows are auto-wrapped with PluginChainProvider so window content
 * has access to chain/wallet/transaction contexts without per-component boilerplate.
 */

import { PluginChainProvider } from "@townexchange/3p-plugin-sdk/client";
import { registerWindow } from "@townexchange/tex-ui-kit";
import { createElement, type ComponentType, type ReactNode } from "react";
import { diceDuelChains } from "../shared/chains";
import {
	DD_INCOMING_WAGER,
	DD_INITIATE_WAGER,
	DD_INVENTORY,
	DD_SHOP,
	DD_WAGER_DETAILS,
	DD_WAGER_HISTORY,
} from "./window-keys";

// biome-ignore lint/suspicious/noExplicitAny: Window keys are strings in 3p context
type AnyWindowKey = any;

/**
 * Wrap a lazy window import so its default export is rendered inside
 * PluginChainProvider. React portals preserve context from the React tree,
 * so portaled GameWindow content still receives chain contexts.
 */
function withChainContext(
	importFn: () => Promise<{ default: ComponentType<any> }>,
): () => Promise<{ default: ComponentType<any> }> {
	return async () => {
		const mod = await importFn();
		const Inner = mod.default;
		function WithChains(props: any) {
			return createElement(
				PluginChainProvider as ComponentType<{
					chainId: number;
					config: typeof diceDuelChains;
					children?: ReactNode;
				}>,
				{ chainId: 0, config: diceDuelChains },
				createElement(Inner, props),
			);
		}
		WithChains.displayName = `WithChains(${Inner.displayName || Inner.name || "Anonymous"})`;
		return { default: WithChains };
	};
}

export function registerDiceDuelWindows(): void {
	registerWindow({
		key: DD_SHOP as AnyWindowKey,
		component: withChainContext(
			() => import("./ui/svm/SvmShop/SvmShopContent"),
		),
		inputMode: "blocking",
	});

	registerWindow({
		key: DD_INVENTORY as AnyWindowKey,
		component: withChainContext(
			() => import("./ui/svm/SvmInventory/SvmInventoryContent"),
		),
	});

	registerWindow({
		key: DD_INITIATE_WAGER as AnyWindowKey,
		component: withChainContext(
			() => import("./ui/svm/SvmWager/InitiateWagerContent"),
		),
	});

	registerWindow({
		key: DD_INCOMING_WAGER as AnyWindowKey,
		component: withChainContext(
			() => import("./ui/svm/SvmWager/AcceptWagerContent"),
		),
	});

	registerWindow({
		key: DD_WAGER_DETAILS as AnyWindowKey,
		component: withChainContext(
			() => import("./ui/svm/SvmWager/SvmWagerDetailsContent"),
		),
	});

	registerWindow({
		key: DD_WAGER_HISTORY as AnyWindowKey,
		component: withChainContext(
			() => import("./ui/svm/SvmWager/SvmWagerHistoryContent"),
		),
	});
}
