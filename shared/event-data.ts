/**
 * Dice Duel Onchain Event Data
 *
 * Shared type definitions for event payloads published by the SVM indexer
 * (handlers.ts) and consumed by the server plugin. Single source of truth
 * for the publisher-consumer NATS contract.
 *
 * Derived from Codama-generated Anchor event types where possible.
 * The wire format uses plain `string` for Address and bigint fields
 * (JSON cannot represent bigint natively).
 */

import type { Address } from "@solana/kit";
import type {
	WagerInitiated,
	WagerAccepted,
	WagerResolvedEvent,
	WinningsClaimed,
	WagerCancelled,
	WagerExpiredEvent,
	VrfTimeoutRefund,
	DiceBagMinted,
	DiceBagUsed,
	ConfigUpdated,
} from "#generated/clients/svm/dice-duel/types";

import type {
	DeserializedDiceBag,
	DeserializedGameConfig,
	DeserializedPlayerStats,
	DeserializedWager,
} from "./svm/program";

// ─── Utility: Codama → wire format ──────────────────────────────────────────

/** Convert Address/bigint fields to string for JSON transport. */
type Stringify<T> = {
	[K in keyof T]: T[K] extends Address
		? string
		: T[K] extends bigint
			? string
			: T[K];
};

/**
 * Accept both string and bigint for fields that are bigint-origin.
 * The SDK's serializePayload() auto-converts bigint → string at the
 * publish boundary, so handlers can pass either form.
 *
 * Only applied to the PublishableDiceDuelEventMap (used by handlers),
 * not the base DiceDuelEventMap (used by consumers).
 */
type Publishable<T> = {
	[K in keyof T]: [T[K]] extends [string]
		? string | bigint
		: [T[K]] extends [string | undefined]
			? string | bigint | undefined
			: T[K];
};

// ─── Event Payloads ─────────────────────────────────────────────────────────

/** wager_initiated — new wager created */
export type WagerInitiatedEventData = Stringify<
	Pick<WagerInitiated, "challenger" | "opponent" | "amount" | "nonce">
> & { wagerAddress: string };

/** wager_accepted — opponent accepted, dice rolling */
export type WagerAcceptedEventData = Stringify<
	Pick<WagerAccepted, "challenger" | "opponent" | "amount">
> & { wagerAddress: string; nonce?: string };

/** wager_cancelled — wager cancelled before acceptance */
export type WagerCancelledEventData = Stringify<
	Pick<WagerCancelled, "challenger">
> & { opponent?: string; wagerAddress: string; nonce?: string };

/** wager_resolved — VRF result in, winner determined, awaiting claim */
export type WagerResolvedEventData = Stringify<
	Pick<
		WagerResolvedEvent,
		| "challenger"
		| "opponent"
		| "winner"
		| "vrfResult"
		| "gameType"
		| "challengerChoice"
		| "amount"
	>
> & { wagerAddress: string; nonce?: string };

/** winnings_claimed — payout complete, wager settled */
export type WinningsClaimedEventData = Stringify<
	Pick<WinningsClaimed, "winner" | "amount" | "payout" | "fee" | "challenger">
> & {
	wagerAddress: string;
	opponent?: string;
	nonce?: string;
};

/** wager_expired / vrf_timeout_claimed — wager timed out */
export type WagerStatusEventData = {
	wagerAddress: string;
	challenger: string;
	opponent: string;
	amount?: string;
	nonce?: string;
};

/** dice_bag_minted — new dice bag NFT minted */
export type DiceBagMintedEventData = Stringify<
	Pick<DiceBagMinted, "player" | "mint">
>;

/** dice_bag_updated — dice bag stats changed */
export type DiceBagUpdatedEventData = {
	player: string;
	mint: string;
	usesRemaining: number;
};

/** config_updated — game config changed on-chain */
export type GameConfigUpdatedEventData = Stringify<
	Pick<
		DeserializedGameConfig,
		| "admin"
		| "treasury"
		| "feeBps"
		| "mintPrice"
		| "initialUses"
		| "isPaused"
		| "wagerExpirySeconds"
		| "vrfTimeoutSeconds"
	>
>;

// ─── Account Type Map ────────────────────────────────────────────────────────

/**
 * Maps "ProgramName:AccountType" handler keys to their deserialized types.
 * Used with `defineAccountHandler()` to automatically type handler
 * callbacks per account type — no manual casting needed.
 */
export interface DiceDuelAccountTypeMap {
	"DiceDuel:Wager": DeserializedWager;
	"DiceDuel:DiceBag": DeserializedDiceBag;
	"DiceDuel:PlayerStats": DeserializedPlayerStats;
	"DiceDuel:GameConfig": DeserializedGameConfig;
}

// ─── Event Map ──────────────────────────────────────────────────────────────

/**
 * Maps event type strings to their payload types.
 * Single source of truth for the publisher-consumer contract.
 */
export interface DiceDuelEventMap {
	wager_initiated: WagerInitiatedEventData;
	wager_accepted: WagerAcceptedEventData;
	wager_cancelled: WagerCancelledEventData;
	wager_resolved: WagerResolvedEventData;
	winnings_claimed: WinningsClaimedEventData;
	wager_expired: WagerStatusEventData;
	vrf_timeout_claimed: WagerStatusEventData;
	dice_bag_minted: DiceBagMintedEventData;
	dice_bag_updated: DiceBagUpdatedEventData;
	config_updated: GameConfigUpdatedEventData;
}

/**
 * Publishable variant of DiceDuelEventMap — accepts bigint for string fields.
 * Used by indexer handlers where the SDK auto-serializes bigint → string.
 */
export type PublishableDiceDuelEventMap = {
	[K in keyof DiceDuelEventMap]: Publishable<DiceDuelEventMap[K]>;
};
