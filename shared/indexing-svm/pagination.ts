/**
 * DiceDuel cursor pagination — thin wrapper over the SDK's generic cursor codec.
 *
 * Two codecs:
 * - Default (createdAt, address) — for the legacy /wagers/:address endpoint
 * - History (settledAt, address) — for /wagers/:address/history (sorted by settlement time)
 */

import { createCursorCodec } from "@anterra/3p-plugin-sdk/indexer";
import type { CursorSortDirection } from "@anterra/3p-plugin-sdk/indexer";

export type { CursorSortDirection as SortDirection };

// ── Default cursor (createdAt, address) ─────────────────────────────────────

const codec = createCursorCodec(["createdAt", "address"]);

export interface WagerCursor {
	createdAt: bigint;
	address: string;
	sort: CursorSortDirection;
}

export function encodeCursor(
	createdAt: bigint,
	address: string,
	sort: CursorSortDirection = "desc",
): string {
	return codec.encode({ createdAt, address }, sort);
}

export function decodeCursor(cursor: string): WagerCursor | null {
	const decoded = codec.decode(cursor);
	if (!decoded) return null;
	return {
		createdAt: BigInt(decoded.values.createdAt || "0"),
		address: decoded.values.address,
		sort: decoded.sort,
	};
}

// ── History cursor (settledAt, address) ─────────────────────────────────────

const historyCodec = createCursorCodec(["settledAt", "address"]);

export interface HistoryCursor {
	settledAt: bigint;
	address: string;
	sort: CursorSortDirection;
}

export function encodeHistoryCursor(
	settledAt: bigint,
	address: string,
	sort: CursorSortDirection = "desc",
): string {
	return historyCodec.encode({ settledAt, address }, sort);
}

export function decodeHistoryCursor(cursor: string): HistoryCursor | null {
	const decoded = historyCodec.decode(cursor);
	if (!decoded) return null;
	return {
		settledAt: BigInt(decoded.values.settledAt || "0"),
		address: decoded.values.address,
		sort: decoded.sort,
	};
}
