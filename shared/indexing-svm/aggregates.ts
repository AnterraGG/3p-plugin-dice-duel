/**
 * DiceDuel SVM Indexing Aggregates
 *
 * Time-series aggregations backed by TimescaleDB continuous aggregates.
 */

import { defineAggregate } from "@townexchange/3p-plugin-sdk/indexer";
import { wagerEventLog } from "./schema";

/**
 * Hourly wager statistics.
 * SVM adapter → TimescaleDB continuous aggregate.
 * Auto-refreshes. Query like a regular table.
 */
export const hourlyWagerStats = defineAggregate("hourly_wager_stats", {
	source: wagerEventLog,
	bucket: { column: "createdAt", interval: "1 hour" },
	columns: {
		wagerCount: { fn: "count" },
		totalVolume: { fn: "sum", column: "amount" },
		uniquePlayers: { fn: "countDistinct", column: "challenger" },
		avgWager: { fn: "avg", column: "amount" },
	},
});

/**
 * Daily wager statistics — for longer-term trends.
 */
export const dailyWagerStats = defineAggregate("daily_wager_stats", {
	source: wagerEventLog,
	bucket: { column: "createdAt", interval: "1 day" },
	columns: {
		wagerCount: { fn: "count" },
		totalVolume: { fn: "sum", column: "amount" },
		uniquePlayers: { fn: "countDistinct", column: "challenger" },
		maxWager: { fn: "max", column: "amount" },
	},
});
