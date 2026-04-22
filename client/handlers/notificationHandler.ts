/**
 * Dice Duel Notification Handler (3p SDK version)
 *
 * Receives server→client WagerNotification and DiceBagNotification messages,
 * dispatches them to the notification store, and invalidates relevant queries
 * via ctx.queries so the UI reflects fresh data immediately.
 *
 * Targeted invalidation: inventory vs history are separate queries,
 * so we only invalidate what changed.
 */

import type { PluginLoadContext } from "@anterra/3p-plugin-sdk/client";
import { DiceBagNotification, WagerNotification } from "../../shared/messages";
import { queryKeys } from "../hooks/svm/queries-indexed";
import { useDiceDuelNotificationStore } from "../store/diceDuelNotificationStore";

const LOG = "[DiceDuel:NotificationHandler]";

/** Invalidate inventory wagers (actionable state changed). */
function invalidateInventory(ctx: PluginLoadContext): void {
	ctx.queries.invalidate(queryKeys.inventoryWagers.all());
}

/** Invalidate wager history (a wager entered terminal state). */
function invalidateHistory(ctx: PluginLoadContext): void {
	ctx.queries.invalidate(queryKeys.wagerHistory.all());
}

/** Invalidate both inventory + history (wager transitioned to terminal). */
function invalidateInventoryAndHistory(ctx: PluginLoadContext): void {
	invalidateInventory(ctx);
	invalidateHistory(ctx);
}

/** Invalidate dice bag queries. */
function invalidateDiceQueries(ctx: PluginLoadContext): void {
	ctx.queries.invalidate(queryKeys.diceBags.all());
}

export function registerDiceDuelNotificationHandler(
	ctx: PluginLoadContext,
): void {
	ctx.messages.on(WagerNotification, (packet) => {
		const store = useDiceDuelNotificationStore.getState();
		console.log(
			`${LOG} Received: ${packet.notificationType} wagerId=${packet.wagerId}`,
		);

		switch (packet.notificationType) {
			case "wager_received":
				store.addNotification({
					type: "wager_received",
					wagerId: packet.wagerId,
					initiator: packet.initiator ?? "",
					opponent: packet.acceptor ?? "",
					amount: packet.amount ?? "0",
					token: packet.token ?? "",
					wagerAddress: packet.wagerAddress,
				});
				// New actionable wager — inventory only
				invalidateInventory(ctx);
				break;

			case "wager_accepted":
				store.addNotification({
					type: "wager_accepted",
					wagerId: packet.wagerId,
					acceptor: packet.acceptor ?? "",
					wagerAddress: packet.wagerAddress,
				});
				// Pending → Active (still actionable) — inventory only
				invalidateInventory(ctx);
				invalidateDiceQueries(ctx);
				break;

			case "wager_ready_to_claim":
				store.addNotification({
					type: "wager_ready_to_claim",
					wagerId: packet.wagerId,
					winner: packet.winner ?? "",
					diceTotal: packet.diceTotal ?? 0,
					wagerAmount: packet.wagerAmount,
					wagerToken: packet.wagerToken,
					wagerAddress: packet.wagerAddress,
				});
				// Became claimable (still actionable) — inventory only
				invalidateInventory(ctx);
				break;

			case "wager_claimed":
				store.addNotification({
					type: "wager_claimed",
					wagerId: packet.wagerId,
					winner: packet.winner ?? "",
					payout: packet.payout,
					fee: packet.fee,
					wagerAddress: packet.wagerAddress,
				});
				// Actionable → terminal — both inventory and history
				invalidateInventoryAndHistory(ctx);
				invalidateDiceQueries(ctx);
				ctx.queries.invalidate(queryKeys.playerStats.all());
				break;

			case "wager_cancelled":
				store.addNotification({
					type: "wager_cancelled",
					wagerId: packet.wagerId,
					initiator: packet.initiator ?? "",
					wagerAddress: packet.wagerAddress,
				});
				// Actionable → terminal — both
				invalidateInventoryAndHistory(ctx);
				break;

			case "wager_expired":
				store.addNotification({
					type: "wager_expired",
					wagerId: packet.wagerId,
					wagerAddress: packet.wagerAddress,
				});
				// Actionable → terminal — both
				invalidateInventoryAndHistory(ctx);
				break;

			case "wager_vrf_timeout":
				store.addNotification({
					type: "wager_vrf_timeout",
					wagerId: packet.wagerId,
					wagerAddress: packet.wagerAddress,
				});
				// Actionable → terminal — both
				invalidateInventoryAndHistory(ctx);
				break;

			default:
				console.warn(
					`${LOG} Unknown notification type: ${packet.notificationType}`,
				);
		}
	});

	// ── Dice Bag Notifications ──────────────────────────────────────────────
	ctx.messages.on(DiceBagNotification, (packet) => {
		const store = useDiceDuelNotificationStore.getState();
		console.log(
			`${LOG} Received dice bag event: ${packet.notificationType} mint=${packet.mint}`,
		);

		switch (packet.notificationType) {
			case "dice_bag_minted":
				store.addNotification({
					type: "dice_bag_minted",
					mint: packet.mint,
					owner: packet.owner,
				});
				invalidateDiceQueries(ctx);
				break;

			case "dice_bag_updated":
				console.log(
					`${LOG} Dice bag updated: mint=${packet.mint} uses=${packet.usesRemaining}`,
				);
				invalidateDiceQueries(ctx);
				break;

			default:
				console.warn(
					`${LOG} Unknown dice bag notification type: ${packet.notificationType}`,
				);
		}
	});
}
