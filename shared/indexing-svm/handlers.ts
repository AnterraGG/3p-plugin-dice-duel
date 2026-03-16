/**
 * DiceDuel SVM Handlers — Unified Event Pipeline
 *
 * columns: declarative DB sync (auto INSERT/UPDATE)
 * events: typed anchor event handlers (NATS + event logs)
 */

import {
	defineAccountHandler,
	eq,
	addr,
	toEpoch,
	epochNow,
} from "@townexchange/3p-plugin-sdk/indexer";
import type {
	InferAnchorEvents,
	IndexingDb,
} from "@townexchange/3p-plugin-sdk/indexer";
import type { Address } from "@solana/kit";
import type { PublishableDiceDuelEventMap } from "../event-data";
import type {
	DeserializedWager,
	DeserializedDiceBag,
	DeserializedPlayerStats,
	DeserializedGameConfig,
} from "../svm/program";
import { diceDuelProgram } from "../svm/program";
import { DICE_DUEL_PROGRAM_ID } from "../programs";
import { computeExpiresAt } from "../svm/wager-utils";
import {
	diceBagTable,
	gameConfigTable,
	playerStatsTable,
	wagerEventLog,
	wagerTable,
} from "./schema";

const PID = DICE_DUEL_PROGRAM_ID;

type DDEvents = InferAnchorEvents<typeof diceDuelProgram>;

// ─── Helpers ───────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_SECONDS = BigInt(3600);
let cachedExpirySeconds: bigint | null = null;

async function getExpirySeconds(db: IndexingDb): Promise<bigint> {
	if (cachedExpirySeconds != null) return cachedExpirySeconds;
	const configs = await db
		.select(gameConfigTable)
		.where(eq(gameConfigTable.programId, PID))
		.limit(1);
	cachedExpirySeconds = configs[0]?.wagerExpirySeconds
		? BigInt(configs[0].wagerExpirySeconds)
		: DEFAULT_EXPIRY_SECONDS;
	return cachedExpirySeconds;
}

function invalidateExpiryCache(): void {
	cachedExpirySeconds = null;
}

async function resolveWagerAddress(e: {
	challenger: Address;
	nonce: bigint;
}): Promise<string> {
	const [pda] = await diceDuelProgram.pdas.findWagerPda(
		e.challenger,
		e.nonce,
	);
	return addr(pda);
}

async function resolveDiceBagAddress(mint: Address): Promise<string> {
	const [pda] = await diceDuelProgram.pdas.findDiceBagPda(mint);
	return addr(pda);
}

// ─── Status Ordering ───────────────────────────────────────────────────────

const WAGER_STATUS_ORDER: Record<string, number> = {
	Pending: 0,
	Active: 1,
	Resolved: 2,
	Settled: 3,
	Cancelled: 3,
	Expired: 3,
	VrfTimeout: 3,
};

// ─── Wager Handler ─────────────────────────────────────────────────────────

export const wagerHandler = defineAccountHandler<
	DeserializedWager,
	PublishableDiceDuelEventMap,
	DDEvents
>(diceDuelProgram, diceDuelProgram.accounts.Wager, wagerTable, {
	statusField: "status",
	statusOrder: WAGER_STATUS_ORDER,
	staticColumns: { programId: PID },
	columns: {
		challenger: "challenger",
		opponent: "opponent",
		challengerBag: "challengerBag",
		amount: "amount",
		gameType: "gameType",
		challengerChoice: "challengerChoice",
		status: "status",
		nonce: "nonce",
		vrfResult: "vrfResult",
		winner: "winner",
		createdAt: (state) => {
			const raw = toEpoch(state.createdAt);
			return raw > 0n ? raw : epochNow();
		},
		settledAt: (state) =>
			state.settledAt ? toEpoch(state.settledAt) : null,
		slot: (_state, meta) => BigInt(meta.slot),
	},

	// expiresAt needs DB access (reads config for wagerExpirySeconds),
	// so it's computed in onSynced rather than columns
	onSynced: async (ctx) => {
		const expirySeconds = await getExpirySeconds(ctx.db);
		const createdAt = toEpoch(ctx.account.createdAt);
		const expiresAt =
			createdAt > 0n
				? computeExpiresAt(createdAt, expirySeconds)
				: null;
		if (expiresAt != null) {
			await ctx.db
				.update(wagerTable, { address: ctx.address })
				.set({ expiresAt });
		}
	},

	resolveAddress: resolveWagerAddress,

	events: {
		WagerInitiated: {
			handler: async (ctx) => {
				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-created-${ctx.slot}`,
					programId: PID,
					eventType: "wager_initiated",
					wagerAddress: ctx.address,
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					amount: ctx.event.amount,
					createdAt: toEpoch(ctx.event.createdAt),
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("wager_initiated", {
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					amount: ctx.event.amount,
					wagerAddress: ctx.address,
					nonce: ctx.event.nonce,
				});
			},
		},

		WagerAccepted: {
			handler: async (ctx) => {
				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-Active-${ctx.slot}`,
					programId: PID,
					eventType: "wager_accepted",
					wagerAddress: ctx.address,
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					amount: ctx.event.amount,
					createdAt: epochNow(),
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("wager_accepted", {
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					amount: ctx.event.amount,
					wagerAddress: ctx.address,
				});
			},
		},

		WagerResolvedEvent: {
			handler: async (ctx) => {
				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-Resolved-${ctx.slot}`,
					programId: PID,
					eventType: "wager_resolved",
					wagerAddress: ctx.address,
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					amount: ctx.event.amount,
					createdAt: epochNow(),
					slot: BigInt(ctx.slot),
					data: {
						winner: addr(ctx.event.winner),
						vrfResult: ctx.event.vrfResult,
					},
				});

				await ctx.publish("wager_resolved", {
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					winner: addr(ctx.event.winner),
					vrfResult: ctx.event.vrfResult,
					gameType: ctx.event.gameType,
					challengerChoice: ctx.event.challengerChoice,
					amount: ctx.event.amount,
					wagerAddress: ctx.address,
				});
			},
		},

		WinningsClaimed: {
			closure: true,
			handler: async (ctx) => {
				const settledAt = toEpoch(ctx.event.settledAt);

				if (ctx.account.challenger) {
					await ctx.db.update(wagerTable, { address: ctx.address }).set({
						status: "Settled",
						settledAt,
						winner: addr(ctx.event.winner),
					});
				}

				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-Settled-${ctx.slot}`,
					programId: PID,
					eventType: "winnings_claimed",
					wagerAddress: ctx.address,
					challenger: addr(ctx.event.challenger),
					opponent: ctx.account.opponent,
					amount: ctx.event.amount,
					createdAt: settledAt,
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("winnings_claimed", {
					winner: addr(ctx.event.winner),
					amount: ctx.event.amount,
					payout: ctx.event.payout,
					fee: ctx.event.fee,
					challenger: addr(ctx.event.challenger),
					opponent: ctx.account.opponent,
					wagerAddress: ctx.address,
				});
			},
		},

		WagerCancelled: {
			closure: true,
			handler: async (ctx) => {
				const settledAt = toEpoch(ctx.event.settledAt);

				if (ctx.account.challenger) {
					await ctx.db.update(wagerTable, { address: ctx.address }).set({
						status: "Cancelled",
						settledAt,
					});
				}

				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-Cancelled-${ctx.slot}`,
					programId: PID,
					eventType: "wager_cancelled",
					wagerAddress: ctx.address,
					challenger: addr(ctx.event.challenger),
					opponent: ctx.account.opponent,
					amount: ctx.account.amount,
					createdAt: settledAt,
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("wager_cancelled", {
					challenger: addr(ctx.event.challenger),
					opponent: ctx.account.opponent,
					wagerAddress: ctx.address,
				});
			},
		},

		WagerExpiredEvent: {
			closure: true,
			handler: async (ctx) => {
				const settledAt = toEpoch(ctx.event.settledAt);

				if (ctx.account.challenger) {
					await ctx.db.update(wagerTable, { address: ctx.address }).set({
						status: "Expired",
						settledAt,
					});
				}

				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-Expired-${ctx.slot}`,
					programId: PID,
					eventType: "wager_expired",
					wagerAddress: ctx.address,
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					amount: ctx.account.amount,
					createdAt: settledAt,
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("wager_expired", {
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					wagerAddress: ctx.address,
				});
			},
		},

		VrfTimeoutRefund: {
			closure: true,
			handler: async (ctx) => {
				const settledAt = toEpoch(ctx.event.settledAt);

				if (ctx.account.challenger) {
					await ctx.db.update(wagerTable, { address: ctx.address }).set({
						status: "VrfTimeout",
						settledAt,
					});
				}

				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-VrfTimeout-${ctx.slot}`,
					programId: PID,
					eventType: "vrf_timeout_claimed",
					wagerAddress: ctx.address,
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					amount: ctx.event.amount,
					createdAt: settledAt,
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("vrf_timeout_claimed", {
					challenger: addr(ctx.event.challenger),
					opponent: addr(ctx.event.opponent),
					amount: ctx.event.amount,
					wagerAddress: ctx.address,
				});
			},
		},
	},
});

// ─── DiceBag Handler ───────────────────────────────────────────────────────

export const diceBagHandler = defineAccountHandler<
	DeserializedDiceBag,
	PublishableDiceDuelEventMap,
	DDEvents
>(diceDuelProgram, diceDuelProgram.accounts.DiceBag, diceBagTable, {
	staticColumns: { programId: PID },
	columns: {
		mint: "mint",
		owner: "owner",
		usesRemaining: "usesRemaining",
		totalGames: "totalGames",
		wins: "wins",
		losses: "losses",
		mintedSlot: (_s, m) => BigInt(m.slot),
	},
	events: {
		DiceBagMinted: {
			resolveAddress: (e) => resolveDiceBagAddress(e.mint),
			handler: async (ctx) => {
				await ctx.publish("dice_bag_minted", {
					player: addr(ctx.event.player),
					mint: addr(ctx.event.mint),
				});
			},
		},
		DiceBagUsed: {
			resolveAddress: (e) => resolveDiceBagAddress(e.mint),
			handler: async (ctx) => {
				await ctx.publish("dice_bag_updated", {
					player: addr(ctx.event.owner),
					mint: addr(ctx.event.mint),
					usesRemaining: ctx.event.usesRemaining,
				});
			},
		},
	},
});

// ─── PlayerStats Handler ───────────────────────────────────────────────────

export const playerStatsHandler = defineAccountHandler<
	DeserializedPlayerStats,
	PublishableDiceDuelEventMap,
	DDEvents
>(diceDuelProgram, diceDuelProgram.accounts.PlayerStats, playerStatsTable, {
	staticColumns: { programId: PID },
	columns: {
		player: "player",
		totalGames: "totalGames",
		wins: "wins",
		losses: "losses",
		solWagered: "solWagered",
		solWon: "solWon",
		currentStreak: "currentStreak",
		bestStreak: "bestStreak",
		wagerNonce: "wagerNonce",
		pendingNonce: "pendingNonce",
	},
});

// ─── GameConfig Handler ────────────────────────────────────────────────────

export const gameConfigHandler = defineAccountHandler<
	DeserializedGameConfig,
	PublishableDiceDuelEventMap,
	DDEvents
>(diceDuelProgram, diceDuelProgram.accounts.GameConfig, gameConfigTable, {
	staticColumns: { programId: PID, id: "singleton" },
	columns: {
		admin: "admin",
		treasury: "treasury",
		feeBps: "feeBps",
		mintPrice: "mintPrice",
		initialUses: "initialUses",
		isPaused: "isPaused",
		wagerExpirySeconds: "wagerExpirySeconds",
		vrfTimeoutSeconds: "vrfTimeoutSeconds",
	},
	onChanged: async (ctx) => {
		invalidateExpiryCache();
	},
	events: {
		ConfigUpdated: {
			resolveAddress: (_e) => "singleton",
			handler: async (ctx) => {
				invalidateExpiryCache();
				await ctx.publish("config_updated", {
					admin: ctx.account.admin,
					treasury: ctx.account.treasury,
					feeBps: ctx.account.feeBps,
					mintPrice: ctx.account.mintPrice,
					initialUses: ctx.account.initialUses,
					isPaused: ctx.account.isPaused,
					wagerExpirySeconds: ctx.account.wagerExpirySeconds,
					vrfTimeoutSeconds: ctx.account.vrfTimeoutSeconds,
				});
			},
		},
	},
});
