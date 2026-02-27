/**
 * DiceDuel SVM Indexing Schema
 *
 * All tables prefixed with `plugin_dice_svm_` to avoid collisions.
 * Uses chain-agnostic defineTable() — no Drizzle, no PG imports.
 *
 * Every table includes a `programId` column so data from different
 * program deployments coexists cleanly. All queries filter by programId.
 */

import { defineTable } from "@townexchange/3p-plugin-sdk/indexer";

// ─── Wager Table ───────────────────────────────────────────────────────────

export const wagerTable = defineTable("plugin_dice_svm_wager", {
	address: { type: "string", primaryKey: true }, // Wager PDA (base58)
	programId: { type: "string", index: true }, // Program ID that owns this data
	challenger: { type: "string", index: true }, // base58 pubkey
	opponent: { type: "string", index: true }, // base58 pubkey
	challengerBag: { type: "string", optional: true }, // DiceBag PDA (not in all events)
	amount: { type: "bigint" }, // lamports
	gameType: { type: "int" },
	challengerChoice: { type: "int" },
	status: { type: "string", index: true }, // Pending|Active|Settled|...
	nonce: { type: "bigint", index: true }, // Wager nonce (unique per challenger)
	vrfResult: { type: "int", optional: true }, // null until VRF resolves
	winner: { type: "string", optional: true }, // null until settled
	createdAt: { type: "bigint" }, // unix epoch seconds
	expiresAt: { type: "bigint", optional: true, index: true }, // unix epoch seconds (createdAt + expirySeconds)
	settledAt: { type: "bigint", optional: true }, // unix epoch seconds
	slot: { type: "bigint" },
});

// ─── DiceBag Table ─────────────────────────────────────────────────────────

export const diceBagTable = defineTable("plugin_dice_svm_dice_bag", {
	mint: { type: "string", primaryKey: true }, // NFT mint (base58)
	address: { type: "string", index: true }, // On-chain PDA (derived from ["dice_bag", mint])
	programId: { type: "string", index: true },
	owner: { type: "string", index: true },
	usesRemaining: { type: "int" },
	totalGames: { type: "int" },
	wins: { type: "int" },
	losses: { type: "int" },
	mintedSlot: { type: "bigint" },
});

// ─── PlayerStats Table ─────────────────────────────────────────────────────

export const playerStatsTable = defineTable("plugin_dice_svm_player_stats", {
	player: { type: "string", primaryKey: true }, // base58 pubkey
	programId: { type: "string", index: true },
	totalGames: { type: "int" },
	wins: { type: "int" },
	losses: { type: "int" },
	solWagered: { type: "bigint" },
	solWon: { type: "bigint" },
	currentStreak: { type: "int" },
	bestStreak: { type: "int" },
	wagerNonce: { type: "bigint" }, // Total wagers ever created
	pendingNonce: { type: "bigint", optional: true }, // Current pending wager nonce (null = no pending)
});

// ─── GameConfig Table (singleton) ──────────────────────────────────────────

export const gameConfigTable = defineTable("plugin_dice_svm_game_config", {
	id: { type: "string", primaryKey: true, default: "singleton" },
	programId: { type: "string", index: true },
	admin: { type: "string" },
	treasury: { type: "string" },
	feeBps: { type: "int" },
	mintPrice: { type: "bigint" },
	initialUses: { type: "int" },
	isPaused: { type: "boolean" },
	wagerExpirySeconds: { type: "bigint" },
	vrfTimeoutSeconds: { type: "bigint" },
});

// ─── Wager Events Log (time-series, hypertable candidate) ──────────────────

export const wagerEventLog = defineTable("plugin_dice_svm_wager_events", {
	id: { type: "string", primaryKey: true }, // composite key
	programId: { type: "string", index: true },
	eventType: { type: "string", index: true },
	wagerAddress: { type: "string", index: true },
	challenger: { type: "string", index: true, optional: true },
	opponent: { type: "string", index: true, optional: true },
	amount: { type: "bigint", optional: true },
	createdAt: { type: "bigint" }, // unix epoch seconds
	slot: { type: "bigint" },
	data: { type: "json", optional: true },
});
