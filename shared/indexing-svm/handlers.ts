/**
 * DiceDuel SVM Unified Handlers
 *
 * Single handler per account type using defineAccountHandler().
 * Replaces the dual defineSvmHandlers() + defineAnchorEventHandlers() pattern.
 *
 * SDK routes from BOTH account-state-diff AND anchor events through
 * a single lifecycle state machine per account type.
 */

import { defineAccountHandler, eq } from "@townexchange/3p-plugin-sdk/indexer";
import type {
	CreatedContext,
	TransitionContext,
	ClosedContext,
	ChangeContext,
	IndexingDb,
	InferInsert,
} from "@townexchange/3p-plugin-sdk/indexer";
import type { DragonDiceEventMap } from "../event-data";
import type { DeserializedWager, DeserializedDiceBag, DeserializedPlayerStats, DeserializedGameConfig } from "../svm/program";
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

// ─── Anchor Event Type Map ────────────────────────────────────────────────

/** Maps event names to their parsed types (for anchorEventMappings type safety) */
interface DiceDuelAnchorEvents {
	WagerInitiated: { challenger: string; opponent: string; amount: bigint; nonce: bigint; gameType: number; createdAt: bigint };
	WagerAccepted: { challenger: string; opponent: string; amount: bigint; nonce: bigint };
	WagerResolvedEvent: { challenger: string; opponent: string; winner: string; vrfResult: number; amount: bigint; nonce: bigint; gameType: number; challengerChoice: number };
	WinningsClaimed: { winner: string; challenger: string; amount: bigint; payout: bigint; fee: bigint; nonce: bigint; settledAt: bigint };
	WagerCancelled: { challenger: string; nonce: bigint; settledAt: bigint };
	WagerExpiredEvent: { challenger: string; opponent: string; nonce: bigint; settledAt: bigint };
	VrfTimeoutRefund: { challenger: string; opponent: string; amount: bigint; nonce: bigint; settledAt: bigint };
}

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

async function deriveWagerAddress(challenger: string, nonce: bigint): Promise<string> {
	const [pda] = await diceDuelProgram.pdas.findWagerPda(challenger as any, nonce);
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

/** Maps on-chain wager status → DragonDiceEventMap key (single source of truth) */
const WAGER_STATUS_EVENT: Record<string, keyof DragonDiceEventMap> & {
	readonly Pending: "wager_initiated";
	readonly Active: "wager_accepted";
	readonly Resolved: "wager_resolved";
	readonly Settled: "winnings_claimed";
	readonly Cancelled: "wager_cancelled";
	readonly Expired: "wager_expired";
	readonly VrfTimeout: "vrf_timeout_claimed";
} = {
	Pending: "wager_initiated",
	Active: "wager_accepted",
	Resolved: "wager_resolved",
	Settled: "winnings_claimed",
	Cancelled: "wager_cancelled",
	Expired: "wager_expired",
	VrfTimeout: "vrf_timeout_claimed",
};

// ─── Wager Handler ─────────────────────────────────────────────────────────

export const wagerHandler = defineAccountHandler<DeserializedWager, DragonDiceEventMap, DiceDuelAnchorEvents>(
	diceDuelProgram.accounts.Wager,
	wagerTable,
	{
		statusField: "status",
		statusOrder: WAGER_STATUS_ORDER,

		onCreated: async (ctx) => {
			const { address, state, slot, db, publishEvent, logger } = ctx;

			const rawCreatedAt = toEpoch(state.createdAt);
			const createdAtEpoch = rawCreatedAt > 0n ? rawCreatedAt : BigInt(Math.floor(Date.now() / 1000));
			const expirySeconds = await getExpirySeconds(db);
			const expiresAt = createdAtEpoch > 0n ? computeExpiresAt(createdAtEpoch, expirySeconds) : null;

			const insertValues: InferInsert<typeof wagerTable> = {
				address,
				programId: PID,
				challenger: state.challenger,
				opponent: state.opponent,
				challengerBag: state.challengerBag,
				amount: state.amount,
				gameType: state.gameType,
				challengerChoice: state.challengerChoice,
				status: state.status,
				nonce: state.nonce,
				createdAt: createdAtEpoch,
				expiresAt,
				slot: BigInt(slot),
				vrfResult: state.vrfResult ?? null,
				winner: state.winner ?? null,
				settledAt: state.settledAt ? toEpoch(state.settledAt) : null,
			};

			if (ctx.source === "anchor-event") {
				// Anchor event only has partial data — insertOrIgnore
				await db.insertOrIgnore(wagerTable).values(insertValues);
			} else {
				// Account-state-diff has full data — upsert
				await db.upsert(wagerTable, insertValues);
			}

			await db.insertOrIgnore(wagerEventLog).values({
				id: `${address}-created-${slot}`,
				programId: PID,
				eventType: WAGER_STATUS_EVENT.Pending,
				wagerAddress: address,
				challenger: state.challenger,
				opponent: state.opponent,
				amount: state.amount,
				createdAt: toEpoch(state.createdAt),
				slot: BigInt(slot),
			});

			logger.info(
				` NEW wager created: ${address} challenger=${state.challenger} opponent=${state.opponent} amount=${state.amount} status=${state.status} createdAt=${createdAtEpoch} expiresAt=${expiresAt}`,
			);

			// Only publish from anchor-event path to avoid duplicate notifications
			// (account-diff also calls onCreated for the same account creation)
			if (ctx.source === "anchor-event") {
				await publishEvent({
					eventType: WAGER_STATUS_EVENT.Pending,
					data: {
						challenger: state.challenger,
						opponent: state.opponent,
						amount: state.amount.toString(),
						wagerAddress: address,
						nonce: state.nonce.toString(),
					},
				});
			}
		},

		transitions: {
			"Pending -> Active": async (ctx) => {
				const { address, state, slot, db, publishEvent, logger } = ctx;
				logger.info(` ACCEPTED: ${address}`);

				await db.update(wagerTable, { address }).set({
					status: "Active",
					challenger: state.challenger,
					opponent: state.opponent,
					amount: state.amount,
				});

				await db.insertOrIgnore(wagerEventLog).values({
					id: `${address}-Active-${slot}`,
					programId: PID,
					eventType: WAGER_STATUS_EVENT.Active,
					wagerAddress: address,
					challenger: state.challenger,
					opponent: state.opponent,
					amount: state.amount,
					createdAt: BigInt(Math.floor(Date.now() / 1000)),
					slot: BigInt(slot),
				});

				// Only publish from anchor-event to avoid duplicates
				if (ctx.source === "anchor-event") {
					await publishEvent({
						eventType: WAGER_STATUS_EVENT.Active,
						data: {
							challenger: state.challenger,
							opponent: state.opponent,
							amount: state.amount.toString(),
							wagerAddress: address,
						},
					});
				}
			},

			"Active -> Resolved": async (ctx) => {
				const { address, state, slot, db, publishEvent, logger } = ctx;

				if (state.winner == null || state.vrfResult == null) {
					logger.error(
						` RESOLVED but missing winner/vrfResult: ${address} winner=${state.winner} vrfResult=${state.vrfResult}`,
					);
					return;
				}

				logger.info(
					` RESOLVED: ${address} winner=${state.winner} vrfResult=${state.vrfResult}`,
				);

				await db.update(wagerTable, { address }).set({
					status: "Resolved",
					vrfResult: state.vrfResult,
					winner: state.winner,
					challenger: state.challenger,
					opponent: state.opponent,
					amount: state.amount,
					...(state.settledAt ? { settledAt: toEpoch(state.settledAt) } : {}),
				});

				await db.insertOrIgnore(wagerEventLog).values({
					id: `${address}-Resolved-${slot}`,
					programId: PID,
					eventType: WAGER_STATUS_EVENT.Resolved,
					wagerAddress: address,
					challenger: state.challenger,
					opponent: state.opponent,
					amount: state.amount,
					createdAt: BigInt(Math.floor(Date.now() / 1000)),
					slot: BigInt(slot),
					data: { winner: state.winner, vrfResult: state.vrfResult },
				});

				// Only publish from anchor-event to avoid duplicates
				if (ctx.source === "anchor-event") {
					await publishEvent({
						eventType: WAGER_STATUS_EVENT.Resolved,
						data: {
							challenger: state.challenger,
							opponent: state.opponent,
							winner: state.winner,
							vrfResult: state.vrfResult,
							gameType: state.gameType,
							challengerChoice: state.challengerChoice,
							amount: state.amount.toString(),
							wagerAddress: address,
						},
					});
				}
			},
		},

		onChange: async (ctx) => {
			const { address, state, previousState, slot, db, publishEvent, logger } = ctx;
			if (!previousState) return;

			const prevStatus = (previousState as unknown as { status: string }).status;
			const currStatus = state.status;
			if (prevStatus === currStatus) return;

			const eventType = WAGER_STATUS_EVENT[currStatus];
			if (!eventType) return;

			// Terminal status transitions not covered by specific transition handlers
			// (Cancelled, Expired, VrfTimeout)
			logger.info(` STATUS CHANGE: ${address} ${prevStatus} → ${currStatus}`);

			await db.update(wagerTable, { address }).set({
				status: currStatus,
				...(state.settledAt ? { settledAt: toEpoch(state.settledAt) } : {}),
			});

			await db.insertOrIgnore(wagerEventLog).values({
				id: `${address}-${currStatus}-${slot}`,
				programId: PID,
				eventType,
				wagerAddress: address,
				challenger: state.challenger,
				opponent: state.opponent,
				amount: state.amount,
				createdAt: BigInt(Math.floor(Date.now() / 1000)),
				slot: BigInt(slot),
			});

			if (currStatus === "Cancelled" || currStatus === "Expired") {
				await publishEvent({
					eventType,
					data: {
						challenger: state.challenger,
						opponent: state.opponent,
						wagerAddress: address,
					},
				});
			} else if (currStatus === "VrfTimeout") {
				await publishEvent({
					eventType,
					data: {
						challenger: state.challenger,
						opponent: state.opponent,
						amount: state.amount.toString(),
						wagerAddress: address,
					},
				});
			}
		},

		onClosed: async (ctx) => {
			const { address, previousState, previousStatus, slot, db, publishEvent, logger } = ctx;

			// Detect claim_winnings: winner is set (from DB Resolved state or WinningsClaimed event).
			// Don't rely solely on previousStatus === "Resolved" — anchor events can arrive
			// before the Active → Resolved account-diff is processed.
			const isClaim = previousStatus === "Resolved" || previousState.winner != null
				|| (ctx.anchorEvent?.name === "WinningsClaimed");

			if (isClaim) {
				// claim_winnings closed the account — mark as Settled
				const settledAt = previousState.settledAt
					? toEpoch(previousState.settledAt)
					: BigInt(Math.floor(Date.now() / 1000));

				await db.update(wagerTable, { address }).set({
					status: "Settled",
					settledAt,
					// Ensure winner is persisted (may not be set yet if race condition)
					...(previousState.winner ? { winner: previousState.winner } : {}),
				});

				await db.insertOrIgnore(wagerEventLog).values({
					id: `${address}-Settled-${slot}`,
					programId: PID,
					eventType: WAGER_STATUS_EVENT.Settled,
					wagerAddress: address,
					challenger: previousState.challenger,
					opponent: previousState.opponent,
					amount: previousState.amount,
					createdAt: BigInt(Math.floor(Date.now() / 1000)),
					slot: BigInt(slot),
				});

				// Only publish from anchor-event to avoid duplicates
				// (also ensures claimData payout/fee are available)
				if (ctx.source === "anchor-event") {
					const claimData = ctx.anchorEvent?.name === "WinningsClaimed"
						? ctx.anchorEvent.data : undefined;

					await publishEvent({
						eventType: WAGER_STATUS_EVENT.Settled,
						data: {
							winner: previousState.winner ?? previousState.challenger,
							amount: previousState.amount.toString(),
							payout: claimData?.payout?.toString(),
							fee: claimData?.fee?.toString(),
							challenger: previousState.challenger,
							opponent: previousState.opponent,
							wagerAddress: address,
						},
					});
				}
			} else {
				// Non-claim closures: cancel, expired claim, vrf timeout claim
				const finalStatus =
					previousStatus === "Expired"
						? "Expired"
						: previousStatus === "VrfTimeout"
							? "VrfTimeout"
							: "Cancelled";

				const eventType = WAGER_STATUS_EVENT[finalStatus];
				if (!eventType) return;

				const settledAt = previousState.settledAt
					? toEpoch(previousState.settledAt)
					: BigInt(Math.floor(Date.now() / 1000));

				await db.update(wagerTable, { address }).set({
					status: finalStatus,
					settledAt,
				});

				await db.insertOrIgnore(wagerEventLog).values({
					id: `${address}-${finalStatus}-${slot}`,
					programId: PID,
					eventType,
					wagerAddress: address,
					challenger: previousState.challenger,
					opponent: previousState.opponent,
					amount: previousState.amount,
					createdAt: BigInt(Math.floor(Date.now() / 1000)),
					slot: BigInt(slot),
				});

				if (finalStatus === "VrfTimeout") {
					await publishEvent({
						eventType,
						data: {
							challenger: previousState.challenger,
							opponent: previousState.opponent,
							amount: previousState.amount.toString(),
							wagerAddress: address,
						},
					});
				} else {
					await publishEvent({
						eventType,
						data: {
							challenger: previousState.challenger,
							opponent: previousState.opponent,
							wagerAddress: address,
						},
					});
				}
			}
		},

		anchorEventMappings: {
			WagerInitiated: {
				lifecycle: "created",
				resolveAddress: async (e) => deriveWagerAddress(e.challenger as string, e.nonce),
				toState: (e) => ({
					challenger: e.challenger as string,
					opponent: e.opponent as string,
					amount: e.amount,
					nonce: e.nonce,
					gameType: e.gameType,
					challengerChoice: 0,
					status: "Pending" as const,
					createdAt: e.createdAt,
				}),
			},
			WagerAccepted: {
				lifecycle: "transition",
				transitionTo: "Active",
				resolveAddress: async (e) => deriveWagerAddress(e.challenger as string, e.nonce),
				toState: (e) => ({
					challenger: e.challenger as string,
					opponent: e.opponent as string,
					amount: e.amount,
					status: "Active" as const,
				}),
			},
			WagerResolvedEvent: {
				lifecycle: "transition",
				transitionTo: "Resolved",
				resolveAddress: async (e) => deriveWagerAddress(e.challenger as string, e.nonce),
				toState: (e) => ({
					challenger: e.challenger as string,
					opponent: e.opponent as string,
					winner: e.winner as string,
					vrfResult: e.vrfResult,
					amount: e.amount,
					gameType: e.gameType,
					challengerChoice: e.challengerChoice,
					status: "Resolved" as const,
				}),
			},
			WinningsClaimed: {
				lifecycle: "closed",
				resolveAddress: async (e) => deriveWagerAddress(e.challenger as string, e.nonce),
				toState: (e) => ({
					winner: e.winner as string,
					challenger: e.challenger as string,
					amount: e.amount,
					payout: e.payout,
					fee: e.fee,
					settledAt: e.settledAt,
				}),
			},
			WagerCancelled: {
				lifecycle: "closed",
				resolveAddress: async (e) => deriveWagerAddress(e.challenger as string, e.nonce),
				toState: (e) => ({
					challenger: e.challenger as string,
					status: "Cancelled" as const,
					settledAt: e.settledAt,
				}),
			},
			WagerExpiredEvent: {
				lifecycle: "closed",
				resolveAddress: async (e) => deriveWagerAddress(e.challenger as string, e.nonce),
				toState: (e) => ({
					challenger: e.challenger as string,
					opponent: e.opponent as string,
					status: "Expired" as const,
					settledAt: e.settledAt,
				}),
			},
			VrfTimeoutRefund: {
				lifecycle: "closed",
				resolveAddress: async (e) => deriveWagerAddress(e.challenger as string, e.nonce),
				toState: (e) => ({
					challenger: e.challenger as string,
					opponent: e.opponent as string,
					amount: e.amount,
					status: "VrfTimeout" as const,
					settledAt: e.settledAt,
				}),
			},
		},
	},
);

// ─── DiceBag Handler ───────────────────────────────────────────────────────

export const diceBagHandler = defineAccountHandler<DeserializedDiceBag, DragonDiceEventMap>(
	diceDuelProgram.accounts.DiceBag,
	diceBagTable,
	{
		onCreated: async ({ address, state, slot, db, publishEvent }) => {
			const existing = await db.find(diceBagTable, { mint: state.mint });

			await db.upsert(diceBagTable, {
				mint: state.mint,
				programId: PID,
				owner: state.owner,
				usesRemaining: state.usesRemaining,
				totalGames: state.totalGames,
				wins: state.wins,
				losses: state.losses,
				mintedSlot: BigInt(slot),
			});

			if (!existing) {
				await publishEvent({
					eventType: "dice_bag_minted",
					data: { player: state.owner, mint: state.mint },
				});
			}
		},

		onChange: async ({ state, previousState, db, publishEvent }) => {
			if (!previousState) return;

			if (
				previousState.usesRemaining !== state.usesRemaining ||
				previousState.totalGames !== state.totalGames
			) {
				await db.update(diceBagTable, { mint: state.mint }).set({
					usesRemaining: state.usesRemaining,
					totalGames: state.totalGames,
					wins: state.wins,
					losses: state.losses,
				});

				await publishEvent({
					eventType: "dice_bag_updated",
					data: {
						player: state.owner,
						mint: state.mint,
						usesRemaining: state.usesRemaining,
					},
				});
			}
		},
	},
);

// ─── PlayerStats Handler ───────────────────────────────────────────────────

export const playerStatsHandler = defineAccountHandler<DeserializedPlayerStats, DragonDiceEventMap>(
	diceDuelProgram.accounts.PlayerStats,
	playerStatsTable,
	{
		onCreated: async ({ state, db }) => {
			await db.upsert(playerStatsTable, {
				player: state.player,
				programId: PID,
				totalGames: state.totalGames,
				wins: state.wins,
				losses: state.losses,
				solWagered: state.solWagered,
				solWon: state.solWon,
				currentStreak: state.currentStreak,
				bestStreak: state.bestStreak,
				wagerNonce: state.wagerNonce,
				pendingNonce: state.pendingNonce,
			});
		},

		onChange: async ({ state, db }) => {
			await db.update(playerStatsTable, { player: state.player }).set({
				programId: PID,
				totalGames: state.totalGames,
				wins: state.wins,
				losses: state.losses,
				solWagered: state.solWagered,
				solWon: state.solWon,
				currentStreak: state.currentStreak,
				bestStreak: state.bestStreak,
				wagerNonce: state.wagerNonce,
				pendingNonce: state.pendingNonce,
			});
		},
	},
);

// ─── GameConfig Handler ────────────────────────────────────────────────────

export const gameConfigHandler = defineAccountHandler<DeserializedGameConfig, DragonDiceEventMap>(
	diceDuelProgram.accounts.GameConfig,
	gameConfigTable,
	{
		onCreated: async ({ state, db, publishEvent }) => {
			await db.upsert(gameConfigTable, {
				id: "singleton",
				programId: PID,
				admin: state.admin,
				treasury: state.treasury,
				feeBps: state.feeBps,
				mintPrice: state.mintPrice,
				initialUses: state.initialUses,
				isPaused: state.isPaused,
				wagerExpirySeconds: state.wagerExpirySeconds,
				vrfTimeoutSeconds: state.vrfTimeoutSeconds,
			});
			invalidateExpiryCache();

			await publishEvent({
				eventType: "config_updated",
				data: {
					admin: state.admin,
					treasury: state.treasury,
					feeBps: state.feeBps,
					mintPrice: state.mintPrice.toString(),
					initialUses: state.initialUses,
					isPaused: state.isPaused,
					wagerExpirySeconds: state.wagerExpirySeconds.toString(),
					vrfTimeoutSeconds: state.vrfTimeoutSeconds.toString(),
				},
			});
		},

		onChange: async ({ state, previousState, db, publishEvent }) => {
			await db.update(gameConfigTable, { id: "singleton" }).set({
				programId: PID,
				admin: state.admin,
				treasury: state.treasury,
				feeBps: state.feeBps,
				mintPrice: state.mintPrice,
				initialUses: state.initialUses,
				isPaused: state.isPaused,
				wagerExpirySeconds: state.wagerExpirySeconds,
				vrfTimeoutSeconds: state.vrfTimeoutSeconds,
			});
			invalidateExpiryCache();

			const changed = !previousState ||
				previousState.admin !== state.admin ||
				previousState.treasury !== state.treasury ||
				previousState.feeBps !== state.feeBps ||
				previousState.mintPrice !== state.mintPrice ||
				previousState.initialUses !== state.initialUses ||
				previousState.isPaused !== state.isPaused ||
				previousState.wagerExpirySeconds !== state.wagerExpirySeconds ||
				previousState.vrfTimeoutSeconds !== state.vrfTimeoutSeconds;

			if (changed) {
				await publishEvent({
					eventType: "config_updated",
					data: {
						admin: state.admin,
						treasury: state.treasury,
						feeBps: state.feeBps,
						mintPrice: state.mintPrice.toString(),
						initialUses: state.initialUses,
						isPaused: state.isPaused,
						wagerExpirySeconds: state.wagerExpirySeconds.toString(),
						vrfTimeoutSeconds: state.vrfTimeoutSeconds.toString(),
					},
				});
			}
		},
	},
);
