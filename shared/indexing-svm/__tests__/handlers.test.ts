import type {
	SvmAccountChange,
	SvmIndexingHandlerContext,
} from "@townexchange/3p-plugin-sdk/indexer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dragonDiceSvmPlugin } from "../plugin";

// Get compiled handlers from the unified plugin descriptor
const svmHandlers = dragonDiceSvmPlugin.svmHandlers;

// ─── Mock DB ───────────────────────────────────────────────────────────────

function createMockSelectBuilder(results: unknown[] = []) {
	const builder: any = {
		where: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue(results),
		then: (resolve: any) => Promise.resolve(results).then(resolve),
	};
	return builder;
}

function createMockDb() {
	const insertValues = vi.fn().mockResolvedValue(undefined);
	const updateSet = vi.fn().mockResolvedValue(undefined);
	return {
		insert: vi.fn().mockReturnValue({ values: insertValues }),
		update: vi.fn().mockReturnValue({ set: updateSet }),
		select: vi.fn().mockReturnValue(createMockSelectBuilder([])),
		find: vi.fn().mockResolvedValue(null),
		delete: vi.fn(),
		upsert: vi.fn().mockResolvedValue(undefined),
		insertOrIgnore: vi
			.fn()
			.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
		_insertValues: insertValues,
		_updateSet: updateSet,
	};
}

const noopLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
};

function createMockContext(
	handlerKey: string,
	overrides: Partial<SvmIndexingHandlerContext> = {},
): SvmIndexingHandlerContext {
	const db = createMockDb();
	return {
		change: { pubkey: "TestPubkey123", data: new Uint8Array(), slot: 100 },
		previousState: null,
		currentState: null,
		db: db as any,
		rpc: { getAccountInfo: vi.fn(), getMultipleAccounts: vi.fn() } as any,
		cluster: "devnet",
		publishEvent: vi.fn().mockResolvedValue(undefined),
		logger: noopLogger,
		...overrides,
		_mockDb: db,
	} as any;
}

describe("svmHandlers descriptor", () => {
	it("has correct type", () => {
		expect(svmHandlers.__type).toBe("plugin-svm-indexing-handlers");
	});

	it("registers expected handler keys", () => {
		expect(svmHandlers.handlers["DiceDuel:Wager"]).toBeDefined();
		expect(svmHandlers.handlers["DiceDuel:DiceBag"]).toBeDefined();
		expect(svmHandlers.handlers["DiceDuel:PlayerStats"]).toBeDefined();
		expect(svmHandlers.handlers["DiceDuel:GameConfig"]).toBeDefined();
	});
});

describe("anchorEventHandlers", () => {
	const anchorHandlers = dragonDiceSvmPlugin.anchorEventHandlers;

	it("has anchor event handlers populated", () => {
		expect(anchorHandlers).toBeDefined();
		expect(Object.keys(anchorHandlers).length).toBeGreaterThan(0);
	});

	it("has expected discriminator keys", () => {
		const expectedDiscs = [
			"cbbf97c7a8e76844", // WagerInitiated
			"858f87cbad520ba3", // WagerAccepted
			"469589ac3aa59c08", // WagerResolvedEvent
			"bbb81dc436754696", // WinningsClaimed
			"0ce367ef40749d48", // WagerCancelled
			"ac7b790000fd8dc3", // WagerExpiredEvent
			"e3dd521cfe679619", // VrfTimeoutRefund
		];
		for (const disc of expectedDiscs) {
			expect(anchorHandlers[disc]).toBeDefined();
		}
	});

	it("has exactly 7 anchor event handlers", () => {
		expect(Object.keys(anchorHandlers).length).toBe(7);
	});
});

describe("DiceDuel:Wager handler", () => {
	const handler = svmHandlers.handlers["DiceDuel:Wager"];

	it("inserts new wager when no previous state", async () => {
		const ctx = createMockContext("DiceDuel:Wager", {
			currentState: {
				challenger: "Challenger1",
				opponent: "Opponent1",
				challengerBag: "Bag1",
				amount: 1000000n,
				gameType: 1,
				challengerChoice: 2,
				status: "Pending",
				nonce: 0n,
				createdAt: 1700000000n,
			},
		});

		await handler(ctx);

		const db = (ctx as any)._mockDb;
		// Should call upsert (wager) + insertOrIgnore (event log)
		expect(db.upsert).toHaveBeenCalledTimes(1);
		expect(db.insertOrIgnore).toHaveBeenCalledTimes(1);
		// Dual-path: account-state-diff also publishes for redundancy (client dedup handles it)
		expect(ctx.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "wager_initiated" }),
		);
	});

	it("detects Pending→Active transition (defers publish to anchor event)", async () => {
		const ctx = createMockContext("DiceDuel:Wager", {
			previousState: {
				status: "Pending",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 0n,
			},
			currentState: {
				status: "Active",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 0n,
			},
		});

		await handler(ctx);

		const db = (ctx as any)._mockDb;
		expect(db.update).toHaveBeenCalled();
		// Dual-path: account-state-diff also publishes for redundancy (client dedup handles it)
		expect(ctx.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "wager_accepted" }),
		);
	});

	it("detects Active→Resolved transition (defers publish to anchor event)", async () => {
		const ctx = createMockContext("DiceDuel:Wager", {
			previousState: {
				status: "Active",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 5n,
			},
			currentState: {
				status: "Resolved",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 5n,
				vrfResult: 4,
				winner: "C1",
			},
		});

		await handler(ctx);

		const db = (ctx as any)._mockDb;
		expect(db.update).toHaveBeenCalled();
		expect(db.insertOrIgnore).toHaveBeenCalled(); // event log
		// Dual-path: account-state-diff also publishes for redundancy (client dedup handles it)
		expect(ctx.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "wager_resolved" }),
		);
	});

	it("detects cancellation (defers publish to anchor event)", async () => {
		const ctx = createMockContext("DiceDuel:Wager", {
			previousState: {
				status: "Pending",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 1n,
			},
			currentState: {
				status: "Cancelled",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 1n,
			},
		});

		await handler(ctx);
		const db = (ctx as any)._mockDb;
		expect(db.update).toHaveBeenCalled();
		// Dual-path: account-state-diff also publishes for redundancy (client dedup handles it)
		expect(ctx.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "wager_cancelled" }),
		);
	});

	it("handles account closure (Resolved→closed = Settled)", async () => {
		const ctx = createMockContext("DiceDuel:Wager", {
			previousState: {
				status: "Resolved",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 5n,
				vrfResult: 4,
				winner: "C1",
			},
			currentState: null,
		});

		await handler(ctx);

		const db = (ctx as any)._mockDb;
		expect(db.update).toHaveBeenCalled();
		expect(ctx.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "winnings_claimed" }),
		);
	});

	it("handles account closure with winner set even if previousStatus is not Resolved (race condition)", async () => {
		// Simulates race condition: WinningsClaimed anchor event arrives before
		// the Active→Resolved account-diff is processed
		const ctx = createMockContext("DiceDuel:Wager", {
			previousState: {
				status: "Active",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 5n,
				winner: "C1", // winner set from WinningsClaimed toState merge
			},
			currentState: null,
		});

		await handler(ctx);

		const db = (ctx as any)._mockDb;
		expect(db.update).toHaveBeenCalled();
		// Should detect as claim (winner is set), not cancel
		expect(ctx.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "winnings_claimed" }),
		);
	});

	it("does nothing when status unchanged", async () => {
		const ctx = createMockContext("DiceDuel:Wager", {
			previousState: {
				status: "Pending",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 0n,
			},
			currentState: {
				status: "Pending",
				challenger: "C1",
				opponent: "O1",
				amount: 1000n,
				nonce: 0n,
			},
		});

		await handler(ctx);

		const db = (ctx as any)._mockDb;
		expect(db.update).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalled();
		expect(ctx.publishEvent).not.toHaveBeenCalled();
	});
});

describe("DiceDuel:DiceBag handler", () => {
	const handler = svmHandlers.handlers["DiceDuel:DiceBag"];

	it("upserts new dice bag and publishes mint event", async () => {
		const ctx = createMockContext("DiceDuel:DiceBag", {
			currentState: {
				mint: "Mint1",
				owner: "Owner1",
				usesRemaining: 5,
				totalGames: 0,
				wins: 0,
				losses: 0,
			},
		});

		await handler(ctx);

		const db = (ctx as any)._mockDb;
		expect(db.upsert).toHaveBeenCalled();
		expect(ctx.publishEvent).toHaveBeenCalledWith({
			eventType: "dice_bag_minted",
			data: { player: "Owner1", mint: "Mint1" },
		});
	});

	it("upserts on cache miss without publishing dice_bag_minted", async () => {
		const ctx = createMockContext("DiceDuel:DiceBag", {
			currentState: {
				mint: "Mint1",
				owner: "Owner1",
				usesRemaining: 3,
				totalGames: 2,
				wins: 1,
				losses: 1,
			},
		});

		// Simulate cache miss: no previousState but record already exists in DB
		const db = (ctx as any)._mockDb;
		db.find.mockResolvedValue({
			mint: "Mint1",
			owner: "Owner1",
			usesRemaining: 4,
		});

		await handler(ctx);

		expect(db.upsert).toHaveBeenCalled();
		// Should NOT publish dice_bag_minted — this is a cache miss, not a real mint
		expect(ctx.publishEvent).not.toHaveBeenCalled();
	});

	it("updates stats when uses change and publishes dice_bag_updated", async () => {
		const ctx = createMockContext("DiceDuel:DiceBag", {
			previousState: {
				mint: "M1",
				owner: "O1",
				usesRemaining: 5,
				totalGames: 0,
				wins: 0,
				losses: 0,
			},
			currentState: {
				mint: "M1",
				owner: "O1",
				usesRemaining: 4,
				totalGames: 1,
				wins: 1,
				losses: 0,
			},
		});

		await handler(ctx);

		const db = (ctx as any)._mockDb;
		expect(db.update).toHaveBeenCalled();
		expect(ctx.publishEvent).toHaveBeenCalledWith({
			eventType: "dice_bag_updated",
			data: { player: "O1", mint: "M1", usesRemaining: 4 },
		});
	});
});

describe("DiceDuel:PlayerStats handler", () => {
	const handler = svmHandlers.handlers["DiceDuel:PlayerStats"];

	it("upserts new player stats with nonce fields", async () => {
		const ctx = createMockContext("DiceDuel:PlayerStats", {
			currentState: {
				player: "P1",
				totalGames: 1,
				wins: 1,
				losses: 0,
				solWagered: 1000n,
				solWon: 2000n,
				currentStreak: 1,
				bestStreak: 1,
				wagerNonce: 1n,
				pendingNonce: 0n,
			},
		});

		await handler(ctx);
		const db = (ctx as any)._mockDb;
		expect(db.upsert).toHaveBeenCalled();
		// Verify nonce fields are included in upserted values
		const upsertedValues = db.upsert.mock.calls[0][1];
		expect(upsertedValues.wagerNonce).toBe(1n);
		expect(upsertedValues.pendingNonce).toBe(0n);
	});

	it("upserts player stats with pendingNonce = null", async () => {
		const ctx = createMockContext("DiceDuel:PlayerStats", {
			currentState: {
				player: "P2",
				totalGames: 5,
				wins: 3,
				losses: 2,
				solWagered: 5000n,
				solWon: 3000n,
				currentStreak: -1,
				bestStreak: 3,
				wagerNonce: 5n,
				pendingNonce: null,
			},
		});

		await handler(ctx);
		const db = (ctx as any)._mockDb;
		expect(db.upsert).toHaveBeenCalled();
		const upsertedValues = db.upsert.mock.calls[0][1];
		expect(upsertedValues.wagerNonce).toBe(5n);
		expect(upsertedValues.pendingNonce).toBeNull();
	});

	it("updates existing player stats", async () => {
		const prev = {
			player: "P1",
			totalGames: 1,
			wins: 1,
			losses: 0,
			solWagered: 1000n,
			solWon: 2000n,
			currentStreak: 1,
			bestStreak: 1,
			wagerNonce: 1n,
			pendingNonce: null,
		};
		const curr = {
			...prev,
			totalGames: 2,
			wins: 2,
			currentStreak: 2,
			bestStreak: 2,
			wagerNonce: 2n,
			pendingNonce: 1n,
		};
		const ctx = createMockContext("DiceDuel:PlayerStats", {
			previousState: prev,
			currentState: curr,
		});

		await handler(ctx);
		const db = (ctx as any)._mockDb;
		expect(db.update).toHaveBeenCalled();
	});
});

describe("DiceDuel:GameConfig handler", () => {
	const handler = svmHandlers.handlers["DiceDuel:GameConfig"];

	it("inserts new config and publishes config_updated", async () => {
		const ctx = createMockContext("DiceDuel:GameConfig", {
			currentState: {
				admin: "Admin1",
				treasury: "Treasury1",
				feeBps: 250,
				mintPrice: 100000000n,
				initialUses: 10,
				isPaused: false,
				wagerExpirySeconds: 3600n,
				vrfTimeoutSeconds: 120n,
			},
		});

		await handler(ctx);
		expect((ctx as any)._mockDb.insert).toHaveBeenCalled();
		expect(ctx.publishEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "config_updated" }),
		);
	});
});
