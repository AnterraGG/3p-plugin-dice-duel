/**
 * Dragon Dice Messages
 *
 * Replaces packets.ts — uses definePluginMessage instead of defineServerPacket.
 * The engine handles binary serialization internally.
 */

import {
	definePluginMessage,
	optional,
} from "@townexchange/3p-plugin-sdk/shared";
import type { InferMessageData } from "@townexchange/3p-plugin-sdk/shared";

/**
 * WagerNotification — sent from server to client when wager events occur.
 */
export const WagerNotification = definePluginMessage("server-to-client", {
	notificationType: "string",
	wagerId: "string",
	initiator: optional("string"),
	acceptor: optional("string"),
	amount: optional("string"),
	token: optional("string"),
	winner: optional("string"),
	diceTotal: optional("uint8"),
	wagerAmount: optional("string"),
	wagerToken: optional("string"),
	/** SVM wager PDA address (base58). Used as wager identifier for SVM chain. */
	wagerAddress: optional("string"),
	/** Payout amount after fees (for claimed notifications) */
	payout: optional("string"),
	/** Fee amount (for claimed notifications) */
	fee: optional("string"),
});

/**
 * Notification types that can be sent to clients.
 *
 * - wager_received: opponent got a new challenge
 * - wager_accepted: both players notified dice are rolling
 * - wager_ready_to_claim: winner determined, awaiting claim (2-step flow)
 * - wager_claimed: winner claimed winnings, wager closed
 * - wager_cancelled: challenger cancelled before acceptance
 * - wager_expired: wager expired without acceptance, challenger refunded
 * - wager_vrf_timeout: VRF timed out, both players refunded
 */
export type DragonDiceNotificationType =
	| "wager_received"
	| "wager_accepted"
	| "wager_ready_to_claim"
	| "wager_claimed"
	| "wager_cancelled"
	| "wager_expired"
	| "wager_vrf_timeout";

/** Inferred data type for WagerNotification (from schema). */
export type WagerNotificationData = InferMessageData<
	(typeof WagerNotification)["schema"]
>;

// ─── Dice Bag Notifications ─────────────────────────────────────────────────

/**
 * DiceBagNotification — sent from server to client for dice bag lifecycle events.
 *
 * Separate from WagerNotification because dice bags have a different data shape
 * (mint address, owner, uses) and different notification semantics.
 */
export const DiceBagNotification = definePluginMessage("server-to-client", {
	notificationType: "string",
	/** Mint address of the dice bag NFT */
	mint: "string",
	/** Owner address */
	owner: "string",
	/** Uses remaining (for minted/updated events) */
	usesRemaining: optional("uint8"),
});

export type DiceBagNotificationType = "dice_bag_minted" | "dice_bag_updated";

/** Inferred data type for DiceBagNotification (from schema). */
export type DiceBagNotificationData = InferMessageData<
	(typeof DiceBagNotification)["schema"]
>;
