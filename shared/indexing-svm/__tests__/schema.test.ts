import { describe, expect, it } from "vitest";
import {
	diceBagTable,
	gameConfigTable,
	playerStatsTable,
	wagerEventLog,
	wagerTable,
} from "../schema";

describe("SVM indexing schema", () => {
	describe("wagerTable", () => {
		it("has correct name", () => {
			expect(wagerTable._name).toBe("plugin_dice_svm_wager");
		});

		it("has address as primary key", () => {
			expect(wagerTable._columns.address.primaryKey).toBe(true);
		});

		it("has indexed columns", () => {
			expect(wagerTable._columns.challenger.index).toBe(true);
			expect(wagerTable._columns.opponent.index).toBe(true);
			expect(wagerTable._columns.status.index).toBe(true);
		});

		it("has nonce column (bigint, indexed)", () => {
			expect(wagerTable._columns.nonce).toBeDefined();
			expect(wagerTable._columns.nonce.type).toBe("bigint");
			expect(wagerTable._columns.nonce.index).toBe(true);
		});

		it("has optional columns", () => {
			expect(wagerTable._columns.vrfResult.optional).toBe(true);
			expect(wagerTable._columns.winner.optional).toBe(true);
			expect(wagerTable._columns.settledAt.optional).toBe(true);
		});

		it("uses bigint for timestamp columns", () => {
			expect(wagerTable._columns.createdAt.type).toBe("bigint");
			expect(wagerTable._columns.settledAt.type).toBe("bigint");
		});

		it("has ColumnRef properties", () => {
			expect(wagerTable.challenger.__type).toBe("column-ref");
			expect(wagerTable.challenger.columnType).toBe("string");
		});
	});

	describe("diceBagTable", () => {
		it("has mint as primary key", () => {
			expect(diceBagTable._columns.mint.primaryKey).toBe(true);
		});

		it("has owner indexed", () => {
			expect(diceBagTable._columns.owner.index).toBe(true);
		});
	});

	describe("playerStatsTable", () => {
		it("has player as primary key", () => {
			expect(playerStatsTable._columns.player.primaryKey).toBe(true);
		});

		it("has correct column types", () => {
			expect(playerStatsTable._columns.solWagered.type).toBe("bigint");
			expect(playerStatsTable._columns.wins.type).toBe("int");
		});

		it("has wagerNonce column (bigint)", () => {
			expect(playerStatsTable._columns.wagerNonce).toBeDefined();
			expect(playerStatsTable._columns.wagerNonce.type).toBe("bigint");
		});

		it("has pendingNonce column (bigint, optional)", () => {
			expect(playerStatsTable._columns.pendingNonce).toBeDefined();
			expect(playerStatsTable._columns.pendingNonce.type).toBe("bigint");
			expect(playerStatsTable._columns.pendingNonce.optional).toBe(true);
		});
	});

	describe("gameConfigTable", () => {
		it("has id as primary key", () => {
			expect(gameConfigTable._columns.id.primaryKey).toBe(true);
		});

		it("has boolean isPaused", () => {
			expect(gameConfigTable._columns.isPaused.type).toBe("boolean");
		});
	});

	describe("wagerEventLog", () => {
		it("is a time-series table", () => {
			expect(wagerEventLog._name).toBe("plugin_dice_svm_wager_events");
			expect(wagerEventLog._columns.createdAt.type).toBe("bigint");
		});

		it("has indexed columns for querying", () => {
			expect(wagerEventLog._columns.eventType.index).toBe(true);
			expect(wagerEventLog._columns.wagerAddress.index).toBe(true);
		});
	});
});
