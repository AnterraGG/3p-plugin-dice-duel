/**
 * SSOT type definitions for DiceDuel SVM API responses.
 *
 * Derived from the indexer schema tables using InferRow, then
 * mapped through JsonSerialized to reflect JSON wire format
 * (bigint → string, since JSON.stringify cannot represent bigint).
 */

import type {
	InferRow,
	JsonSerialized,
} from "@townexchange/3p-plugin-sdk/indexer";
import type {
	diceBagTable,
	gameConfigTable,
	playerStatsTable,
	wagerTable,
} from "./schema";

// ─── Row types (as received over the wire) ─────────────────────────────────

/** Row type for a wager as returned by the indexer API */
export type SvmWager = JsonSerialized<InferRow<typeof wagerTable>>;

/** Row type for a dice bag */
export type SvmDiceBag = JsonSerialized<InferRow<typeof diceBagTable>>;

/** Row type for player stats */
export type SvmPlayerStats = JsonSerialized<InferRow<typeof playerStatsTable>>;

/** Row type for game config */
export type SvmGameConfig = JsonSerialized<InferRow<typeof gameConfigTable>>;

/** Wager status string literal union */
export type SvmWagerStatus = SvmWager["status"];

// ─── Compact wager type (8 fields — for history/inventory rendering) ──────

/** Lightweight wager projection for list rendering (history, inventory). */
export interface SvmWagerCompact {
	address: string;
	challenger: string;
	opponent: string;
	amount: string;
	status: string;
	winner: string | null;
	createdAt: string;
	settledAt: string | null;
}

// ─── Composite response types ──────────────────────────────────────────────

/** Response from GET /wagers/:address/inventory */
export interface SvmInventoryWagersResponse {
	actionable: {
		incoming: SvmWager[];
		outgoing: SvmWager[];
		active: SvmWager[];
		claimable: SvmWager[];
		resolved: SvmWager[];
		vrfTimeout: SvmWager[];
	};
	recentHistory: SvmWagerCompact[];
	totalHistoryCount: number;
	summary: {
		incomingCount: number;
		outgoingCount: number;
		activeCount: number;
		claimableCount: number;
		totalActionableCount: number;
	};
}

/** Response from GET /wagers/:address/history */
export interface SvmWagerHistoryResponse {
	wagers: SvmWagerCompact[];
	nextCursor: string | null;
	hasMore: boolean;
	totalCount: number;
}
