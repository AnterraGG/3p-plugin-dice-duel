/**
 * DiceDuel Account Deserialization (Shared Module)
 *
 * Thin adapter over Codama-generated account decoders.
 * Maintains the same public API as the original hand-written deserializers
 * for backward compatibility with the indexer framework.
 *
 * Codama-generated decoders handle all Borsh parsing; this module
 * provides discriminator constants, account sizes, and adapter functions
 * that convert Codama's Option<T>/WagerStatus types to the plain
 * null/string types expected by the indexer handlers.
 */

import { getBase58Decoder } from "@solana/kit";
import type { Address, Option } from "@solana/kit";

// ─── Codama-generated imports ──────────────────────────────────────────────

import {
	DICE_BAG_DISCRIMINATOR,
	GAME_CONFIG_DISCRIMINATOR,
	GAME_TYPE_DISCRIMINATOR,
	PLAYER_STATS_DISCRIMINATOR,
	WAGER_DISCRIMINATOR,
	getDiceBagDecoder,
	getDiceBagSize,
	getGameConfigDecoder,
	getGameConfigSize,
	getPlayerStatsDecoder,
	getPlayerStatsEncoder,
	getWagerDecoder,
	getWagerEncoder,
} from "#generated/clients/svm/dice-duel/accounts";
import {
	DiceDuelAccount,
	identifyDiceDuelAccount,
} from "#generated/clients/svm/dice-duel/programs";
import { WagerStatus as CodamaWagerStatus } from "#generated/clients/svm/dice-duel/types";

// ─── Account Discriminators ────────────────────────────────────────────────

export const DISCRIMINATORS = {
	DiceBag: DICE_BAG_DISCRIMINATOR,
	GameConfig: GAME_CONFIG_DISCRIMINATOR,
	GameType: GAME_TYPE_DISCRIMINATOR,
	PlayerStats: PLAYER_STATS_DISCRIMINATOR,
	Wager: WAGER_DISCRIMINATOR,
} as const;

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Hex-encoded discriminators for use in SVM indexing config */
export const DISCRIMINATORS_HEX = {
	DiceBag: toHex(DICE_BAG_DISCRIMINATOR),
	GameConfig: toHex(GAME_CONFIG_DISCRIMINATOR),
	GameType: toHex(GAME_TYPE_DISCRIMINATOR),
	PlayerStats: toHex(PLAYER_STATS_DISCRIMINATOR),
	Wager: toHex(WAGER_DISCRIMINATOR),
} as const;

/** Extract byte size from an encoder (handles both fixed-size and variable-size codecs). */
function getEncoderSize(encoder: {
	fixedSize?: number;
	maxSize?: number;
}): number {
	if (typeof encoder.fixedSize === "number") return encoder.fixedSize;
	if (typeof encoder.maxSize === "number") return encoder.maxSize;
	throw new Error("Cannot determine encoder size");
}

/** Account data sizes (bytes) — all derived from Codama-generated codecs.
 * Fixed-size accounts use getSize(). Variable-size accounts use encoder.maxSize. */
export const ACCOUNT_SIZES = {
	DiceBag: getDiceBagSize(),
	GameConfig: getGameConfigSize(),
	PlayerStats: getEncoderSize(getPlayerStatsEncoder()),
	Wager: getEncoderSize(getWagerEncoder()),
} as const;

// ─── Wager Status Enum ─────────────────────────────────────────────────────

export type WagerStatus =
	| "Pending"
	| "Active"
	| "ReadyToSettle"
	| "Settled"
	| "Cancelled"
	| "Expired"
	| "VrfTimeout"
	| "Resolved";

const WAGER_STATUS_NAMES: Record<number, WagerStatus> = {
	[CodamaWagerStatus.Pending]: "Pending",
	[CodamaWagerStatus.Active]: "Active",
	[CodamaWagerStatus.ReadyToSettle]: "ReadyToSettle",
	[CodamaWagerStatus.Settled]: "Settled",
	[CodamaWagerStatus.Cancelled]: "Cancelled",
	[CodamaWagerStatus.Expired]: "Expired",
	[CodamaWagerStatus.VrfTimeout]: "VrfTimeout",
	[CodamaWagerStatus.Resolved]: "Resolved",
};

// ─── Option helpers ────────────────────────────────────────────────────────

function unwrapOption<T>(opt: Option<T>): T | null {
	return opt.__option === "Some" ? opt.value : null;
}

/** Validate the 8-byte discriminator prefix matches expectations */
function assertDiscriminator(
	data: Uint8Array,
	expected: Uint8Array,
	name: string,
): void {
	if (data.length < 8) {
		throw new Error(
			`Invalid ${name} discriminator: data too short (${data.length} bytes)`,
		);
	}
	for (let i = 0; i < 8; i++) {
		if (data[i] !== expected[i]) {
			throw new Error(`Invalid ${name} discriminator`);
		}
	}
}

// ─── Deserialized Types (backward-compatible) ──────────────────────────────

export interface DeserializedDiceBag {
	mint: string;
	owner: string;
	usesRemaining: number;
	totalGames: number;
	wins: number;
	losses: number;
	bump: number;
}

export interface DeserializedWager {
	address: string;
	challenger: string;
	opponent: string;
	challengerBag: string;
	amount: bigint;
	gameType: number;
	challengerChoice: number;
	status: WagerStatus;
	nonce: bigint;
	vrfRequestedAt: bigint;
	vrfFulfilledAt: bigint | null;
	vrfResult: number | null;
	winner: string | null;
	createdAt: bigint;
	settledAt: bigint | null;
	threshold: number;
	payoutMultiplierBps: number;
	escrowBump: number;
	bump: number;
}

export interface DeserializedPlayerStats {
	player: string;
	totalGames: number;
	wins: number;
	losses: number;
	solWagered: bigint;
	solWon: bigint;
	currentStreak: number;
	bestStreak: number;
	wagerNonce: bigint;
	pendingNonce: bigint | null;
	bump: number;
}

export interface DeserializedGameConfig {
	admin: string;
	treasury: string;
	feeBps: number;
	mintPrice: bigint;
	initialUses: number;
	isPaused: boolean;
	wagerExpirySeconds: bigint;
	vrfTimeoutSeconds: bigint;
	bump: number;
}

// ─── Decoders (singleton instances) ────────────────────────────────────────

const wagerDecoder = getWagerDecoder();
const diceBagDecoder = getDiceBagDecoder();
const playerStatsDecoder = getPlayerStatsDecoder();
const gameConfigDecoder = getGameConfigDecoder();

// ─── Deserializers ─────────────────────────────────────────────────────────

export function deserializeDiceBag(data: Uint8Array): DeserializedDiceBag {
	assertDiscriminator(data, DICE_BAG_DISCRIMINATOR, "DiceBag");
	const decoded = diceBagDecoder.decode(data);
	return {
		mint: decoded.mint as string,
		owner: decoded.owner as string,
		usesRemaining: decoded.usesRemaining,
		totalGames: decoded.totalGames,
		wins: decoded.wins,
		losses: decoded.losses,
		bump: decoded.bump,
	};
}

export function deserializeWager(
	data: Uint8Array,
	address = "",
): DeserializedWager {
	assertDiscriminator(data, WAGER_DISCRIMINATOR, "Wager");
	if (data.length !== ACCOUNT_SIZES.Wager) {
		throw new Error(
			`Invalid Wager account size: expected ${ACCOUNT_SIZES.Wager}, got ${data.length}`,
		);
	}
	const decoded = wagerDecoder.decode(data);
	return {
		address,
		challenger: decoded.challenger as string,
		opponent: decoded.opponent as string,
		challengerBag: decoded.challengerBag as string,
		amount: decoded.amount,
		gameType: decoded.gameType,
		challengerChoice: decoded.challengerChoice,
		status: WAGER_STATUS_NAMES[decoded.status] ?? "Pending",
		nonce: decoded.nonce,
		vrfRequestedAt: decoded.vrfRequestedAt,
		vrfFulfilledAt: unwrapOption(decoded.vrfFulfilledAt),
		vrfResult: unwrapOption(decoded.vrfResult),
		winner: unwrapOption(decoded.winner) as string | null,
		createdAt: decoded.createdAt,
		settledAt: unwrapOption(decoded.settledAt),
		threshold: decoded.threshold,
		payoutMultiplierBps: decoded.payoutMultiplierBps,
		escrowBump: decoded.escrowBump,
		bump: decoded.bump,
	};
}

export function deserializePlayerStats(
	data: Uint8Array,
): DeserializedPlayerStats {
	const decoded = playerStatsDecoder.decode(data);
	return {
		player: decoded.player as string,
		totalGames: decoded.totalGames,
		wins: decoded.wins,
		losses: decoded.losses,
		solWagered: decoded.solWagered,
		solWon: decoded.solWon,
		currentStreak: decoded.currentStreak,
		bestStreak: decoded.bestStreak,
		wagerNonce: decoded.wagerNonce,
		pendingNonce: unwrapOption(decoded.pendingNonce),
		bump: decoded.bump,
	};
}

export function deserializeGameConfig(
	data: Uint8Array,
): DeserializedGameConfig {
	const decoded = gameConfigDecoder.decode(data);
	return {
		admin: decoded.admin as string,
		treasury: decoded.treasury as string,
		feeBps: decoded.feeBps,
		mintPrice: decoded.mintPrice,
		initialUses: decoded.initialUses,
		isPaused: decoded.isPaused,
		wagerExpirySeconds: decoded.wagerExpirySeconds,
		vrfTimeoutSeconds: decoded.vrfTimeoutSeconds,
		bump: decoded.bump,
	};
}

/**
 * Identify account type from discriminator bytes.
 */
export function identifyAccountType(
	data: Uint8Array,
): keyof typeof DISCRIMINATORS | null {
	try {
		const result = identifyDiceDuelAccount(data);
		const names: Record<DiceDuelAccount, keyof typeof DISCRIMINATORS> = {
			[DiceDuelAccount.DiceBag]: "DiceBag",
			[DiceDuelAccount.GameConfig]: "GameConfig",
			[DiceDuelAccount.GameType]: "GameType",
			[DiceDuelAccount.PlayerStats]: "PlayerStats",
			[DiceDuelAccount.Wager]: "Wager",
		};
		return names[result] ?? null;
	} catch {
		return null;
	}
}
