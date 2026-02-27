/**
 * DiceDuel SVM Handlers — Unified Event Pipeline
 *
 * columns: declarative DB sync (auto INSERT/UPDATE)
 * events: typed anchor event handlers (NATS + event logs)
 */

import {
	defineAccountHandler,
	closure,
	eq,
} from "@townexchange/3p-plugin-sdk/indexer";
import type {
	InferAnchorEvents,
	IndexingDb,
} from "@townexchange/3p-plugin-sdk/indexer";
import type { DiceDuelEventMap } from "../event-data";
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

function toEpoch(seconds: number | bigint): bigint {
	return BigInt(seconds);
}

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

async function resolveWager(e: {
	challenger: unknown;
	nonce: bigint;
}): Promise<string> {
	const [pda] = await diceDuelProgram.pdas.findWagerPda(
		e.challenger as any,
		e.nonce,
	);
	return pda as string;
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
	DiceDuelEventMap,
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
			return raw > 0n ? raw : BigInt(Math.floor(Date.now() / 1000));
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

	events: {
		WagerInitiated: {
			resolveAddress: resolveWager,
			handler: async (ctx) => {
				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-created-${ctx.slot}`,
					programId: PID,
					eventType: "wager_initiated",
					wagerAddress: ctx.address,
					challenger: ctx.account.challenger,
					opponent: ctx.account.opponent,
					amount: ctx.account.amount,
					createdAt: toEpoch(ctx.account.createdAt),
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("wager_initiated", {
					challenger: ctx.account.challenger,
					opponent: ctx.account.opponent,
					amount: ctx.account.amount.toString(),
					wagerAddress: ctx.address,
					nonce: ctx.account.nonce.toString(),
				});
			},
		},

		WagerAccepted: {
			resolveAddress: resolveWager,
			handler: async (ctx) => {
				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-Active-${ctx.slot}`,
					programId: PID,
					eventType: "wager_accepted",
					wagerAddress: ctx.address,
					challenger: ctx.account.challenger,
					opponent: ctx.account.opponent,
					amount: ctx.account.amount,
					createdAt: BigInt(Math.floor(Date.now() / 1000)),
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("wager_accepted", {
					challenger: ctx.account.challenger,
					opponent: ctx.account.opponent,
					amount: ctx.account.amount.toString(),
					wagerAddress: ctx.address,
				});
			},
		},

		WagerResolvedEvent: {
			resolveAddress: resolveWager,
			handler: async (ctx) => {
				const event = ctx.event as DDEvents["WagerResolvedEvent"];

				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-Resolved-${ctx.slot}`,
					programId: PID,
					eventType: "wager_resolved",
					wagerAddress: ctx.address,
					challenger: ctx.account.challenger,
					opponent: ctx.account.opponent,
					amount: ctx.account.amount,
					createdAt: BigInt(Math.floor(Date.now() / 1000)),
					slot: BigInt(ctx.slot),
					data: {
						winner: ctx.account.winner,
						vrfResult: ctx.account.vrfResult,
					},
				});

				await ctx.publish("wager_resolved", {
					challenger: ctx.account.challenger,
					opponent: ctx.account.opponent,
					winner: ctx.account.winner ?? ctx.account.challenger,
					vrfResult: ctx.account.vrfResult ?? 0,
					gameType: ctx.account.gameType,
					challengerChoice: ctx.account.challengerChoice,
					amount: ctx.account.amount.toString(),
					wagerAddress: ctx.address,
				});
			},
		},

		WinningsClaimed: closure({
			resolveAddress: resolveWager,
			handler: async (ctx) => {
				const event = ctx.event as DDEvents["WinningsClaimed"];
				// Closure: account may be {} during replay — read from DB first
				const row = await ctx.db.find(wagerTable, { address: ctx.address });
				const acct = row ?? ctx.account;
				const settledAt = event.settledAt
					? toEpoch(event.settledAt)
					: BigInt(Math.floor(Date.now() / 1000));

				if (row) {
					await ctx.db.update(wagerTable, { address: ctx.address }).set({
						status: "Settled",
						settledAt,
						winner: acct.winner ?? (event.winner as string),
					});
				}

				await ctx.db.insertOrIgnore(wagerEventLog).values({
					id: `${ctx.address}-Settled-${ctx.slot}`,
					programId: PID,
					eventType: "winnings_claimed",
					wagerAddress: ctx.address,
					challenger: (event.challenger as string) ?? acct.challenger,
					opponent: acct.opponent,
					amount: (event.amount as bigint | undefined) ?? acct.amount,
					createdAt: settledAt,
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("winnings_claimed", {
					winner: (event.winner as string) ?? acct.winner ?? acct.challenger,
					amount: (event.amount ?? acct.amount)?.toString() ?? "0",
					payout: event.payout?.toString(),
					fee: event.fee?.toString(),
					challenger: (event.challenger as string) ?? acct.challenger,
					opponent: acct.opponent,
					wagerAddress: ctx.address,
				});
			},
		}),

		WagerCancelled: closure({
			resolveAddress: resolveWager,
			handler: async (ctx) => {
				const event = ctx.event as DDEvents["WagerCancelled"];
				const row = await ctx.db.find(wagerTable, { address: ctx.address });
				const acct = row ?? ctx.account;
				const settledAt = event.settledAt
					? toEpoch(event.settledAt)
					: BigInt(Math.floor(Date.now() / 1000));

				if (row) {
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
					challenger: (event.challenger as string) ?? acct.challenger,
					opponent: acct.opponent,
					amount: acct.amount,
					createdAt: settledAt,
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("wager_cancelled", {
					challenger: (event.challenger as string) ?? acct.challenger,
					opponent: acct.opponent,
					wagerAddress: ctx.address,
				});
			},
		}),

		WagerExpiredEvent: closure({
			resolveAddress: resolveWager,
			handler: async (ctx) => {
				const event = ctx.event as DDEvents["WagerExpiredEvent"];
				const row = await ctx.db.find(wagerTable, { address: ctx.address });
				const acct = row ?? ctx.account;
				const settledAt = event.settledAt
					? toEpoch(event.settledAt)
					: BigInt(Math.floor(Date.now() / 1000));

				if (row) {
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
					challenger: (event.challenger as string) ?? acct.challenger,
					opponent: (event.opponent as string) ?? acct.opponent,
					amount: acct.amount,
					createdAt: settledAt,
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("wager_expired", {
					challenger: (event.challenger as string) ?? acct.challenger,
					opponent: (event.opponent as string) ?? acct.opponent,
					wagerAddress: ctx.address,
				});
			},
		}),

		VrfTimeoutRefund: closure({
			resolveAddress: resolveWager,
			handler: async (ctx) => {
				const event = ctx.event as DDEvents["VrfTimeoutRefund"];
				const row = await ctx.db.find(wagerTable, { address: ctx.address });
				const acct = row ?? ctx.account;
				const settledAt = event.settledAt
					? toEpoch(event.settledAt)
					: BigInt(Math.floor(Date.now() / 1000));

				if (row) {
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
					challenger: (event.challenger as string) ?? acct.challenger,
					opponent: (event.opponent as string) ?? acct.opponent,
					amount: (event.amount as bigint | undefined) ?? acct.amount,
					createdAt: settledAt,
					slot: BigInt(ctx.slot),
				});

				await ctx.publish("vrf_timeout_claimed", {
					challenger: (event.challenger as string) ?? acct.challenger,
					opponent: (event.opponent as string) ?? acct.opponent,
					amount: (event.amount ?? acct.amount)?.toString() ?? "0",
					wagerAddress: ctx.address,
				});
			},
		}),
	},
});

// ─── DiceBag Handler ───────────────────────────────────────────────────────

export const diceBagHandler = defineAccountHandler<
	DeserializedDiceBag,
	DiceDuelEventMap,
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
			resolveAddress: async (e) => {
				// Resolve to the on-chain DiceBag PDA (not the mint address)
				// so the EventBuffer drain key matches the state-diff key.
				const [pda] = await diceDuelProgram.pdas.findDiceBagPda(
					(e as DDEvents["DiceBagMinted"]).mint as any,
				);
				return pda as string;
			},
			handler: async (ctx) => {
				await ctx.publish("dice_bag_minted", {
					player: ctx.account.owner,
					mint: ctx.account.mint,
				});
			},
		},
		DiceBagUsed: {
			resolveAddress: async (e) => {
				const [pda] = await diceDuelProgram.pdas.findDiceBagPda(
					(e as DDEvents["DiceBagUsed"]).mint as any,
				);
				return pda as string;
			},
			handler: async (ctx) => {
				await ctx.publish("dice_bag_updated", {
					player: ctx.account.owner,
					mint: ctx.account.mint,
					usesRemaining: ctx.account.usesRemaining,
				});
			},
		},
	},
});

// ─── PlayerStats Handler ───────────────────────────────────────────────────

export const playerStatsHandler = defineAccountHandler<
	DeserializedPlayerStats,
	DiceDuelEventMap,
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
	DiceDuelEventMap,
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
					mintPrice: ctx.account.mintPrice.toString(),
					initialUses: ctx.account.initialUses,
					isPaused: ctx.account.isPaused,
					wagerExpirySeconds: ctx.account.wagerExpirySeconds.toString(),
					vrfTimeoutSeconds: ctx.account.vrfTimeoutSeconds.toString(),
				});
			},
		},
	},
});
