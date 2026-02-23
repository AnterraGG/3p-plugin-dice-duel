/**
 * DiceDuel SVM Indexing API
 *
 * REST endpoints for querying indexed DiceDuel data.
 * Uses defineResourceApi() for standard CRUD and custom routes
 * for complex business logic (inventory categorization, cursor pagination).
 */

import {
	and,
	defineResourceApi,
	eq,
	gt,
	inArray,
	keyBy,
	lt,
	not,
	or,
	rateLimit,
	validateSolanaAddress,
} from "@townexchange/3p-plugin-sdk/indexer";
import { DICE_DUEL_PROGRAM_ID } from "../programs";
import {
	diceBagTable,
	gameConfigTable,
	playerStatsTable,
	wagerTable,
} from "./schema";

import {
	type SortDirection,
	decodeHistoryCursor,
	encodeHistoryCursor,
} from "./pagination";
import type { SvmWagerCompact } from "./types";

const PID = DICE_DUEL_PROGRAM_ID;

const ACTIONABLE_STATUSES = ["Pending", "Active", "Resolved"] as const;

function toCompact(w: {
	address: string;
	challenger: string;
	opponent: string;
	amount: string | bigint;
	status: string;
	winner: string | null;
	createdAt: string | bigint;
	settledAt: string | bigint | null;
}): SvmWagerCompact {
	return {
		address: w.address,
		challenger: w.challenger,
		opponent: w.opponent,
		amount: String(w.amount),
		status: w.status,
		winner: w.winner ?? null,
		createdAt: String(w.createdAt),
		settledAt: w.settledAt != null ? String(w.settledAt) : null,
	};
}

export const svmApi = defineResourceApi({
	basePath: "/dragon-dice/svm",
	resources: {
		diceBags: {
			name: "dice-bags",
			table: diceBagTable,
			primaryLookup: { column: "owner", responseKey: "diceBags" },
			lookupBy: ["mint"],
		},
		stats: {
			name: "stats",
			table: playerStatsTable,
			primaryLookup: { column: "player", singular: true, responseKey: "stats" },
		},
		leaderboard: {
			name: "leaderboard",
			table: playerStatsTable,
			filterBy: ["programId"],
			orderBy: { default: "wins", defaultDirection: "desc" },
		},
	},

	custom: (router, db) => {
		const addressLimit = rateLimit({
			maxRequests: 60,
			keyExtractor: keyBy.composite(keyBy.ip(), keyBy.param("address")),
		});
		const wagerAddressLimit = rateLimit({
			maxRequests: 60,
			keyExtractor: keyBy.composite(keyBy.ip(), keyBy.param("wagerAddress")),
		});

		// ── Inventory (actionable + 5 recent history) ────────────────────────
		router.get("/wagers/:address/inventory", addressLimit, async (req, res) => {
			let address: string;
			try {
				address = validateSolanaAddress(req.param("address"));
			} catch {
				return res.error("Invalid Solana address", 400);
			}

			const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
			const playerCondition = or(
				eq(wagerTable.challenger, address),
				eq(wagerTable.opponent, address),
			);

			const [actionableRows, historyRows, totalHistoryCount] = await Promise.all([
				db
					.select(wagerTable)
					.where(
						and(
							eq(wagerTable.programId, PID),
							playerCondition,
							inArray(wagerTable.status, [...ACTIONABLE_STATUSES]),
						),
					)
					.orderBy(wagerTable.createdAt, "desc"),
				db
					.select(wagerTable)
					.where(
						and(
							eq(wagerTable.programId, PID),
							playerCondition,
							not(inArray(wagerTable.status, [...ACTIONABLE_STATUSES])),
						),
					)
					.orderBy(wagerTable.settledAt, "desc")
					.orderBy(wagerTable.address, "desc")
					.limit(6),
				db
					.select(wagerTable)
					.where(
						and(
							eq(wagerTable.programId, PID),
							playerCondition,
							not(inArray(wagerTable.status, [...ACTIONABLE_STATUSES])),
						),
					)
					.count(),
			]);

			const isPendingExpired = (w: (typeof actionableRows)[number]) =>
				w.status === "Pending" && w.expiresAt != null && BigInt(w.expiresAt) < nowSeconds;

			const incoming = actionableRows.filter(
				(w) => w.status === "Pending" && w.opponent === address && !isPendingExpired(w),
			);
			const outgoing = actionableRows.filter(
				(w) => w.status === "Pending" && w.challenger === address && !isPendingExpired(w),
			);
			const active = actionableRows.filter((w) => w.status === "Active");
			const claimable = actionableRows.filter(
				(w) => w.status === "Resolved" && w.winner === address,
			);
			const resolved = actionableRows.filter(
				(w) => w.status === "Resolved" && w.winner !== address,
			);
			const vrfTimeout = actionableRows.filter((w) => w.status === "VrfTimeout");

			const recentHistory: SvmWagerCompact[] = historyRows.slice(0, 5).map(toCompact);

			return res.json({
				actionable: { incoming, outgoing, active, claimable, resolved, vrfTimeout },
				recentHistory,
				totalHistoryCount,
				summary: {
					incomingCount: incoming.length,
					outgoingCount: outgoing.length,
					activeCount: active.length,
					claimableCount: claimable.length,
					totalActionableCount:
						incoming.length + outgoing.length + active.length + claimable.length + resolved.length + vrfTimeout.length,
				},
			});
		});

		// ── History (cursor-paginated, compact rows) ──────────────────────────
		router.get("/wagers/:address/history", addressLimit, async (req, res) => {
			let address: string;
			try {
				address = validateSolanaAddress(req.param("address"));
			} catch {
				return res.error("Invalid Solana address", 400);
			}

			const rawLimit = Number(req.query("limit") ?? "20");
			const limit = Math.min(Math.max(1, Number.isNaN(rawLimit) ? 20 : rawLimit), 100);
			const sortParam = req.query("sort");
			const sort: SortDirection = sortParam === "asc" ? "asc" : "desc";
			const cursorParam = req.query("cursor");
			const cursor = cursorParam ? decodeHistoryCursor(cursorParam) : null;

			if (cursor && cursor.sort !== sort) {
				return res.error(
					"Cursor was created with a different sort direction. Start a new query.",
					400,
				);
			}

			const playerCondition = or(
				eq(wagerTable.challenger, address),
				eq(wagerTable.opponent, address),
			);

			const terminalConditions = [
				eq(wagerTable.programId, PID),
				playerCondition,
				not(inArray(wagerTable.status, [...ACTIONABLE_STATUSES])),
			];

			if (cursor) {
				const cmp = sort === "desc" ? lt : gt;
				terminalConditions.push(
					or(
						cmp(wagerTable.settledAt, cursor.settledAt),
						and(
							eq(wagerTable.settledAt, cursor.settledAt),
							cmp(wagerTable.address, cursor.address),
						),
					),
				);
			}

			const fetchLimit = limit + 1;
			const dataPromise = db
				.select(wagerTable)
				.where(and(...terminalConditions))
				.orderBy(wagerTable.settledAt, sort)
				.orderBy(wagerTable.address, sort)
				.limit(fetchLimit);

			const countPromise = cursor
				? Promise.resolve(-1)
				: db
						.select(wagerTable)
						.where(
							and(
								eq(wagerTable.programId, PID),
								playerCondition,
								not(inArray(wagerTable.status, [...ACTIONABLE_STATUSES])),
							),
						)
						.count();

			const [rows, totalCount] = await Promise.all([dataPromise, countPromise]);
			const hasMore = rows.length > limit;
			const slice = hasMore ? rows.slice(0, limit) : rows;

			const lastRow = slice[slice.length - 1];
			const nextCursor =
				hasMore && lastRow
					? encodeHistoryCursor(
							BigInt(lastRow.settledAt ?? lastRow.createdAt ?? 0),
							lastRow.address,
							sort,
						)
					: null;

			return res.json({
				wagers: slice.map(toCompact),
				nextCursor,
				hasMore,
				totalCount,
			});
		});

		// ── Single wager detail ───────────────────────────────────────────────
		router.get("/wagers/detail/:wagerAddress", wagerAddressLimit, async (req, res) => {
			let wagerAddress: string;
			try {
				wagerAddress = validateSolanaAddress(req.param("wagerAddress"));
			} catch {
				return res.error("Invalid Solana address", 400);
			}

			const wager = await db.find(wagerTable, { address: wagerAddress });
			if (!wager || wager.programId !== PID) {
				return res.error("Wager not found", 404);
			}

			return res.json({ wager });
		});

		// ── Game config (singleton) ──────────────────────────────────────────
		router.get("/config", async (_req, res) => {
			const results = await db
				.select(gameConfigTable)
				.where(eq(gameConfigTable.programId, PID))
				.limit(1);
			return res.json({ config: results[0] ?? null });
		});
	},
});
