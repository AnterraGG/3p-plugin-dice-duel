/**
 * DiceDuel Program Descriptor
 *
 * Replaces deserialize.ts — all discriminators, sizes, deserializers,
 * event parsers, and PDA helpers are auto-derived from Codama artifacts.
 */

import { defineProgram } from "@anterra/3p-plugin-sdk/indexer";
import type { Option } from "@solana/kit";

// ─── Codama-generated imports ──────────────────────────────────────────────

import {
	DICE_BAG_DISCRIMINATOR,
	GAME_CONFIG_DISCRIMINATOR,
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
import { WagerStatus as CodamaWagerStatus } from "#generated/clients/svm/dice-duel/types";
import {
	getConfigUpdatedDecoder,
	getDiceBagMintedDecoder,
	getDiceBagUsedDecoder,
	getVrfTimeoutRefundDecoder,
	getWagerAcceptedDecoder,
	getWagerCancelledDecoder,
	getWagerExpiredEventDecoder,
	getWagerInitiatedDecoder,
	getWagerResolvedEventDecoder,
	getWinningsClaimedDecoder,
} from "#generated/clients/svm/dice-duel/types";
import { findWagerPda, findDiceBagPda, findStatsPda } from "#generated/clients/svm/dice-duel/pdas";

import { DICE_DUEL_PROGRAM_ID } from "../programs";

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

// ─── Deserialized Types ────────────────────────────────────────────────────

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

// ─── Transform functions ───────────────────────────────────────────────────

function transformWager(decoded: any, address: string): DeserializedWager {
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

function transformDiceBag(decoded: any): DeserializedDiceBag {
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

function transformPlayerStats(decoded: any): DeserializedPlayerStats {
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

function transformGameConfig(decoded: any): DeserializedGameConfig {
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

// ─── Event discriminators (sha256("event:<EventName>")[0..8]) ──────────────

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

const EVT_DISC = {
	WagerInitiated: hexToBytes("cbbf97c7a8e76844"),
	WagerAccepted: hexToBytes("858f87cbad520ba3"),
	WagerResolvedEvent: hexToBytes("469589ac3aa59c08"),
	WinningsClaimed: hexToBytes("bbb81dc436754696"),
	WagerCancelled: hexToBytes("0ce367ef40749d48"),
	WagerExpiredEvent: hexToBytes("ac7b790000fd8dc3"),
	VrfTimeoutRefund: hexToBytes("e3dd521cfe679619"),
	DiceBagMinted: hexToBytes("6d01d97611b3ac11"),
	DiceBagUsed: hexToBytes("46c4758e317b1ca0"),
	ConfigUpdated: hexToBytes("28f1e67a0b13c6c2"),
} as const;

// ─── Program Descriptor ────────────────────────────────────────────────────

export const diceDuelProgram = defineProgram("DiceDuel", {
	programId: DICE_DUEL_PROGRAM_ID,
	cluster: "devnet",
	accounts: {
		Wager: {
			discriminator: WAGER_DISCRIMINATOR,
			decoder: getWagerDecoder,
			encoder: getWagerEncoder,
			transform: transformWager,
		},
		DiceBag: {
			discriminator: DICE_BAG_DISCRIMINATOR,
			decoder: getDiceBagDecoder,
			size: getDiceBagSize(),
			transform: transformDiceBag,
		},
		PlayerStats: {
			discriminator: PLAYER_STATS_DISCRIMINATOR,
			decoder: getPlayerStatsDecoder,
			encoder: getPlayerStatsEncoder,
			transform: transformPlayerStats,
		},
		GameConfig: {
			discriminator: GAME_CONFIG_DISCRIMINATOR,
			decoder: getGameConfigDecoder,
			size: getGameConfigSize(),
			transform: transformGameConfig,
		},
	},
	events: {
		WagerInitiated: { discriminator: EVT_DISC.WagerInitiated, decoder: getWagerInitiatedDecoder },
		WagerAccepted: { discriminator: EVT_DISC.WagerAccepted, decoder: getWagerAcceptedDecoder },
		WagerResolvedEvent: { discriminator: EVT_DISC.WagerResolvedEvent, decoder: getWagerResolvedEventDecoder },
		WinningsClaimed: { discriminator: EVT_DISC.WinningsClaimed, decoder: getWinningsClaimedDecoder },
		WagerCancelled: { discriminator: EVT_DISC.WagerCancelled, decoder: getWagerCancelledDecoder },
		WagerExpiredEvent: { discriminator: EVT_DISC.WagerExpiredEvent, decoder: getWagerExpiredEventDecoder },
		VrfTimeoutRefund: { discriminator: EVT_DISC.VrfTimeoutRefund, decoder: getVrfTimeoutRefundDecoder },
		DiceBagMinted: { discriminator: EVT_DISC.DiceBagMinted, decoder: getDiceBagMintedDecoder },
		DiceBagUsed: { discriminator: EVT_DISC.DiceBagUsed, decoder: getDiceBagUsedDecoder },
		ConfigUpdated: { discriminator: EVT_DISC.ConfigUpdated, decoder: getConfigUpdatedDecoder },
	},
	pdas: { findWagerPda, findDiceBagPda, findStatsPda },
});
