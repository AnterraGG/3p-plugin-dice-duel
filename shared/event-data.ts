/**
 * Dragon Dice Onchain Event Data
 *
 * Shared type definitions for event payloads published by the SVM indexer
 * (handlers.ts / anchor-events.ts) and consumed by the server plugin.
 * Single source of truth — both sides import from here.
 *
 * Named with `EventData` suffix to distinguish from the raw Anchor-decoded
 * event types (WagerInitiatedEvent, etc.) in anchor-events.ts.
 */

/** wager_initiated — new wager created */
export interface WagerInitiatedEventData {
	challenger: string;
	opponent: string;
	amount: string;
	wagerAddress: string;
	nonce?: string;
}

/** wager_accepted — opponent accepted, dice rolling */
export interface WagerAcceptedEventData {
	challenger: string;
	opponent: string;
	wagerAddress: string;
	amount?: string;
	nonce?: string;
}

/** wager_cancelled — wager cancelled before acceptance */
export interface WagerCancelledEventData {
	challenger: string;
	opponent?: string;
	wagerAddress: string;
	nonce?: string;
}

/** wager_resolved — VRF result in, winner determined, awaiting claim */
export interface WagerResolvedEventData {
	challenger: string;
	opponent: string;
	winner: string;
	vrfResult: number;
	gameType: number;
	challengerChoice: number;
	amount: string;
	wagerAddress: string;
	nonce?: string;
}

/** winnings_claimed — payout complete, wager settled */
export interface WinningsClaimedEventData {
	winner: string;
	amount: string;
	payout?: string;
	fee?: string;
	settledAt?: string;
	challenger?: string;
	opponent?: string;
	wagerAddress?: string;
	nonce?: string;
}

/** wager_expired / vrf_timeout_claimed — wager timed out */
export interface WagerStatusEventData {
	wagerAddress: string;
	challenger: string;
	opponent: string;
	amount?: string;
	nonce?: string;
}

/** dice_bag_minted — new dice bag NFT minted */
export interface DiceBagMintedEventData {
	player: string;
	mint: string;
}

/** dice_bag_updated — dice bag stats changed */
export interface DiceBagUpdatedEventData {
	player: string;
	mint: string;
	usesRemaining: number;
}

/** config_updated — game config changed on-chain */
export interface GameConfigUpdatedEventData {
	admin: string;
	treasury: string;
	feeBps: number;
	mintPrice: string;
	initialUses: number;
	isPaused: boolean;
	wagerExpirySeconds: string;
	vrfTimeoutSeconds: string;
}

// ─── Account Type Map ────────────────────────────────────────────────────────

import type {
	DeserializedDiceBag,
	DeserializedGameConfig,
	DeserializedPlayerStats,
	DeserializedWager,
} from "./svm/program";

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
 * Single source of truth for the publisher→consumer contract.
 */
export interface DragonDiceEventMap {
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
