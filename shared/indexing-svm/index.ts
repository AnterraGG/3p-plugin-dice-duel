/**
 * DiceDuel SVM Indexing Entry Point
 *
 * Exports the unified SvmPluginDescriptor and schema tables.
 */

export {
	wagerTable,
	diceBagTable,
	playerStatsTable,
	gameConfigTable,
	wagerEventLog,
} from "./schema";

export { hourlyWagerStats, dailyWagerStats } from "./aggregates";

// ─── Plugin Descriptor (new unified entry point) ──────────────────────────
export { dragonDiceSvmPlugin } from "./plugin";

// ─── Individual exports (for direct access if needed) ─────────────────────
export {
	wagerHandler,
	diceBagHandler,
	playerStatsHandler,
	gameConfigHandler,
} from "./handlers";
export { svmApi } from "./api";

// SSOT API response types (derived from schema via InferRow)
export type {
	SvmWager,
	SvmWagerCompact,
	SvmDiceBag,
	SvmPlayerStats,
	SvmGameConfig,
	SvmWagerStatus,
	SvmInventoryWagersResponse,
	SvmWagerHistoryResponse,
} from "./types";
