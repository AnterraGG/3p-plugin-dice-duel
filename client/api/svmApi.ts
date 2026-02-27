/**
 * SVM API Client — Phase 6.2
 *
 * All SVM data fetching goes through the injected IndexerApiClient.
 * No hardcoded URLs. The bridge provides the client with the correct base URL.
 */

import type { IndexerApiClient } from "@townexchange/3p-plugin-sdk/indexer";

// ─── Logging ───────────────────────────────────────────────────────────────

const LOG_PREFIX = "[DiceDuel:API]";

function logRequest(
	method: string,
	path: string,
	params?: Record<string, string>,
) {
	const paramStr = params ? `?${new URLSearchParams(params)}` : "";
	console.log(`${LOG_PREFIX} ${method} ${path}${paramStr}`);
}

function logResponse(path: string, data: unknown, durationMs: number) {
	console.log(`${LOG_PREFIX} ✅ ${path} (${durationMs}ms)`, data);
}

function logError(path: string, error: unknown, durationMs: number) {
	console.error(`${LOG_PREFIX} ❌ ${path} (${durationMs}ms)`, error);
}

async function trackedGet<T>(
	api: IndexerApiClient,
	path: string,
	params?: Record<string, string>,
): Promise<T> {
	logRequest("GET", path, params);
	const start = performance.now();
	try {
		const result = await api.get<T>(path, params);
		logResponse(path, result, Math.round(performance.now() - start));
		return result;
	} catch (err) {
		logError(path, err, Math.round(performance.now() - start));
		throw err;
	}
}

// ─── Response Types (SSOT: derived from schema) ───────────────────────────

import type {
	SvmDiceBag,
	SvmGameConfig,
	SvmInventoryWagersResponse,
	SvmPlayerStats,
	SvmWager,
	SvmWagerCompact,
	SvmWagerHistoryResponse,
	SvmWagerStatus,
} from "../../shared/indexing-svm/types";

export type {
	SvmWager,
	SvmDiceBag,
	SvmPlayerStats,
	SvmGameConfig,
	SvmWagerStatus,
	SvmWagerCompact,
	SvmInventoryWagersResponse,
	SvmWagerHistoryResponse,
};

// ─── Fetchers (use injected IndexerApiClient) ──────────────────────────────

export function fetchInventoryWagers(
	api: IndexerApiClient,
	address: string,
): Promise<SvmInventoryWagersResponse> {
	return trackedGet(api, `/dice-duel/svm/wagers/${address}/inventory`);
}

export function fetchWagerHistory(
	api: IndexerApiClient,
	address: string,
	opts?: { limit?: number; cursor?: string; sort?: "asc" | "desc" },
): Promise<SvmWagerHistoryResponse> {
	const params: Record<string, string> = {};
	if (opts?.limit) params.limit = String(opts.limit);
	if (opts?.cursor) params.cursor = opts.cursor;
	if (opts?.sort) params.sort = opts.sort;
	return trackedGet(api, `/dice-duel/svm/wagers/${address}/history`, params);
}

export function fetchWagerDetail(
	api: IndexerApiClient,
	wagerAddress: string,
): Promise<{ wager: SvmWager }> {
	return trackedGet(api, `/dice-duel/svm/wagers/detail/${wagerAddress}`);
}

export function fetchSvmDiceBags(
	api: IndexerApiClient,
	address: string,
): Promise<{ diceBags: SvmDiceBag[] }> {
	return trackedGet(api, `/dice-duel/svm/dice-bags/${address}`);
}

export function fetchSvmPlayerStats(
	api: IndexerApiClient,
	address: string,
): Promise<{ stats: SvmPlayerStats | null }> {
	return trackedGet(api, `/dice-duel/svm/stats/${address}`);
}

export function fetchSvmGameConfig(
	api: IndexerApiClient,
): Promise<{ config: SvmGameConfig }> {
	return trackedGet(api, "/dice-duel/svm/config");
}

// fetchPriorityFees moved to @townexchange/3p-plugin-sdk/client
