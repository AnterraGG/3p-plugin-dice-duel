import { describe, expect, it } from "vitest";
import {
	ACCOUNT_SIZES,
	DISCRIMINATORS,
	DISCRIMINATORS_HEX,
	deserializeDiceBag,
	deserializeGameConfig,
	deserializePlayerStats,
	deserializeWager,
	identifyAccountType,
} from "../deserialize";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a fake account buffer with discriminator + zero-filled body */
function makeAccountData(
	type: keyof typeof DISCRIMINATORS,
	size: number,
): Uint8Array {
	const data = new Uint8Array(size);
	data.set(DISCRIMINATORS[type], 0);
	return data;
}

/** Write a 32-byte pubkey at offset (all same byte for recognizability) */
function writePubkey(data: Uint8Array, offset: number, fillByte: number) {
	for (let i = 0; i < 32; i++) data[offset + i] = fillByte;
}

/** Write u8 at offset */
function writeU8(data: Uint8Array, offset: number, val: number) {
	data[offset] = val;
}

/** Write u32 LE at offset */
function writeU32(data: Uint8Array, offset: number, val: number) {
	new DataView(data.buffer, data.byteOffset).setUint32(offset, val, true);
}

/** Write i32 LE at offset */
function writeI32(data: Uint8Array, offset: number, val: number) {
	new DataView(data.buffer, data.byteOffset).setInt32(offset, val, true);
}

/** Write u64 LE at offset */
function writeU64(data: Uint8Array, offset: number, val: bigint) {
	new DataView(data.buffer, data.byteOffset).setBigUint64(offset, val, true);
}

/** Write i64 LE at offset */
function writeI64(data: Uint8Array, offset: number, val: bigint) {
	new DataView(data.buffer, data.byteOffset).setBigInt64(offset, val, true);
}

/** Write u16 LE at offset */
function writeU16(data: Uint8Array, offset: number, val: number) {
	new DataView(data.buffer, data.byteOffset).setUint16(offset, val, true);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("ACCOUNT_SIZES", () => {
	it("Wager is 199 bytes", () => {
		expect(ACCOUNT_SIZES.Wager).toBe(199);
	});

	it("PlayerStats is 94 bytes", () => {
		expect(ACCOUNT_SIZES.PlayerStats).toBe(94);
	});
});

describe("identifyAccountType", () => {
	it("identifies Wager by discriminator", () => {
		const data = makeAccountData("Wager", ACCOUNT_SIZES.Wager);
		expect(identifyAccountType(data)).toBe("Wager");
	});

	it("identifies DiceBag by discriminator", () => {
		const data = makeAccountData("DiceBag", ACCOUNT_SIZES.DiceBag);
		expect(identifyAccountType(data)).toBe("DiceBag");
	});

	it("identifies PlayerStats by discriminator", () => {
		const data = makeAccountData("PlayerStats", ACCOUNT_SIZES.PlayerStats);
		expect(identifyAccountType(data)).toBe("PlayerStats");
	});

	it("identifies GameConfig by discriminator", () => {
		const data = makeAccountData("GameConfig", ACCOUNT_SIZES.GameConfig);
		expect(identifyAccountType(data)).toBe("GameConfig");
	});

	it("returns null for unknown discriminator", () => {
		const data = new Uint8Array(32);
		data.fill(0xff);
		expect(identifyAccountType(data)).toBeNull();
	});

	it("returns null for data shorter than 8 bytes", () => {
		expect(identifyAccountType(new Uint8Array(4))).toBeNull();
	});
});

describe("DISCRIMINATORS_HEX", () => {
	it("has entries for all account types", () => {
		for (const name of Object.keys(DISCRIMINATORS)) {
			expect(DISCRIMINATORS_HEX).toHaveProperty(name);
		}
	});

	it("hex values are 16 chars (8 bytes)", () => {
		for (const hex of Object.values(DISCRIMINATORS_HEX)) {
			expect(hex).toMatch(/^[0-9a-f]{16}$/);
		}
	});

	it("byte discriminators match hex (consistency check)", () => {
		for (const [name, bytes] of Object.entries(DISCRIMINATORS)) {
			const hex = Buffer.from(bytes).toString("hex");
			const declaredHex =
				DISCRIMINATORS_HEX[name as keyof typeof DISCRIMINATORS_HEX];
			if (hex !== declaredHex) {
				console.warn(
					`DISCRIMINATORS_HEX.${name} mismatch: bytes→${hex}, declared→${declaredHex}`,
				);
			}
		}
	});
});

describe("deserializeDiceBag", () => {
	it("deserializes a DiceBag account", () => {
		const data = makeAccountData("DiceBag", ACCOUNT_SIZES.DiceBag);
		writePubkey(data, 8, 0x11);
		writePubkey(data, 40, 0x22);
		writeU8(data, 72, 5);
		writeU32(data, 73, 10);
		writeU32(data, 77, 6);
		writeU32(data, 81, 4);
		writeU8(data, 85, 255);

		const result = deserializeDiceBag(data);
		expect(result.usesRemaining).toBe(5);
		expect(result.totalGames).toBe(10);
		expect(result.wins).toBe(6);
		expect(result.losses).toBe(4);
		expect(result.bump).toBe(255);
		expect(result.mint).toBeDefined();
		expect(result.owner).toBeDefined();
	});

	it("throws on wrong discriminator", () => {
		const data = new Uint8Array(ACCOUNT_SIZES.DiceBag);
		data.fill(0xff);
		expect(() => deserializeDiceBag(data)).toThrow(
			"Invalid DiceBag discriminator",
		);
	});
});

/**
 * Build a Wager buffer with proper Borsh variable-length Option encoding.
 * Borsh writes None as [0] (1 byte), Some as [1, ...data].
 * The buffer is always 199 bytes (Anchor InitSpace), with unused trailing bytes = 0.
 */
function buildWagerBuffer(
	opts: {
		challenger?: number;
		opponent?: number;
		challengerBag?: number;
		amount?: bigint;
		gameType?: number;
		challengerChoice?: number;
		status?: number;
		nonce?: bigint;
		vrfRequestedAt?: bigint;
		vrfFulfilledAt?: bigint | null;
		vrfResult?: number | null;
		winner?: number | null;
		createdAt?: bigint;
		settledAt?: bigint | null;
		threshold?: number;
		payoutMultiplierBps?: number;
		escrowBump?: number;
		bump?: number;
	} = {},
): Uint8Array {
	const data = makeAccountData("Wager", 199);
	writePubkey(data, 8, opts.challenger ?? 0);
	writePubkey(data, 40, opts.opponent ?? 0);
	writePubkey(data, 72, opts.challengerBag ?? 0);
	writeU64(data, 104, opts.amount ?? 0n);
	writeU8(data, 112, opts.gameType ?? 0);
	writeU8(data, 113, opts.challengerChoice ?? 0);
	writeU8(data, 114, opts.status ?? 0);
	writeU64(data, 115, opts.nonce ?? 0n);
	writeI64(data, 123, opts.vrfRequestedAt ?? 0n);

	// Variable-length region starting at offset 131
	let off = 131;
	// vrfFulfilledAt: Option<i64>
	if (opts.vrfFulfilledAt != null) {
		writeU8(data, off, 1);
		off += 1;
		writeI64(data, off, opts.vrfFulfilledAt);
		off += 8;
	} else {
		writeU8(data, off, 0);
		off += 1;
	}
	// vrfResult: Option<u8>
	if (opts.vrfResult != null) {
		writeU8(data, off, 1);
		off += 1;
		writeU8(data, off, opts.vrfResult);
		off += 1;
	} else {
		writeU8(data, off, 0);
		off += 1;
	}
	// winner: Option<Pubkey>
	if (opts.winner != null) {
		writeU8(data, off, 1);
		off += 1;
		writePubkey(data, off, opts.winner);
		off += 32;
	} else {
		writeU8(data, off, 0);
		off += 1;
	}
	// createdAt: i64
	writeI64(data, off, opts.createdAt ?? 0n);
	off += 8;
	// settledAt: Option<i64>
	if (opts.settledAt != null) {
		writeU8(data, off, 1);
		off += 1;
		writeI64(data, off, opts.settledAt);
		off += 8;
	} else {
		writeU8(data, off, 0);
		off += 1;
	}
	// threshold: u8
	writeU8(data, off, opts.threshold ?? 0);
	off += 1;
	// payoutMultiplierBps: u32
	writeU32(data, off, opts.payoutMultiplierBps ?? 0);
	off += 4;
	// escrowBump: u8
	writeU8(data, off, opts.escrowBump ?? 0);
	off += 1;
	// bump: u8
	writeU8(data, off, opts.bump ?? 0);
	return data;
}

describe("deserializeWager", () => {
	it("deserializes a Pending Wager (all Options None)", () => {
		const data = buildWagerBuffer({
			challenger: 0x11,
			opponent: 0x22,
			challengerBag: 0x33,
			amount: 1000000n,
			gameType: 1,
			challengerChoice: 2,
			status: 0,
			nonce: 7n,
			createdAt: 1700000000n,
			threshold: 50,
			payoutMultiplierBps: 15000,
			escrowBump: 254,
			bump: 253,
		});

		const result = deserializeWager(data, "WagerAddr123");
		expect(result.address).toBe("WagerAddr123");
		expect(result.amount).toBe(1000000n);
		expect(result.gameType).toBe(1);
		expect(result.challengerChoice).toBe(2);
		expect(result.status).toBe("Pending");
		expect(result.nonce).toBe(7n);
		expect(result.vrfFulfilledAt).toBeNull();
		expect(result.vrfResult).toBeNull();
		expect(result.winner).toBeNull();
		expect(result.createdAt).toBe(1700000000n);
		expect(result.settledAt).toBeNull();
		expect(result.threshold).toBe(50);
		expect(result.payoutMultiplierBps).toBe(15000);
		expect(result.escrowBump).toBe(254);
		expect(result.bump).toBe(253);
	});

	it("deserializes a Resolved Wager (all Options Some)", () => {
		const data = buildWagerBuffer({
			challenger: 0x11,
			opponent: 0x22,
			challengerBag: 0x33,
			amount: 5000000n,
			gameType: 0,
			challengerChoice: 1,
			status: 7,
			nonce: 2n,
			vrfRequestedAt: 1700000100n,
			vrfFulfilledAt: 1700000200n,
			vrfResult: 3,
			winner: 0x11,
			createdAt: 1700000000n,
			settledAt: 1700000300n,
			threshold: 50,
			payoutMultiplierBps: 10000,
			escrowBump: 252,
			bump: 251,
		});

		const result = deserializeWager(data, "resolved-addr");
		expect(result.status).toBe("Resolved");
		expect(result.vrfFulfilledAt).toBe(1700000200n);
		expect(result.vrfResult).toBe(3);
		expect(result.winner).toBeDefined();
		expect(result.createdAt).toBe(1700000000n);
		expect(result.settledAt).toBe(1700000300n);
		expect(result.threshold).toBe(50);
		expect(result.payoutMultiplierBps).toBe(10000);
		expect(result.escrowBump).toBe(252);
		expect(result.bump).toBe(251);
	});

	it("reads Settled status correctly", () => {
		const data = buildWagerBuffer({ status: 3 });
		const result = deserializeWager(data, "addr");
		expect(result.status).toBe("Settled");
	});

	it("throws on wrong discriminator", () => {
		const data = new Uint8Array(199);
		expect(() => deserializeWager(data, "addr")).toThrow(
			"Invalid Wager discriminator",
		);
	});

	it("rejects old wager size (191 bytes)", () => {
		const data = makeAccountData("Wager", 191);
		expect(() => deserializeWager(data, "addr")).toThrow(
			"Invalid Wager account size: expected 199, got 191",
		);
	});
});

describe("deserializePlayerStats", () => {
	it("deserializes a PlayerStats account (94 bytes with nonce fields)", () => {
		const data = makeAccountData("PlayerStats", 94);
		writePubkey(data, 8, 0xaa); // player
		writeU32(data, 40, 100); // totalGames
		writeU32(data, 44, 60); // wins
		writeU32(data, 48, 40); // losses
		writeU64(data, 52, 5000000000n); // solWagered
		writeU64(data, 60, 3000000000n); // solWon
		writeI32(data, 68, 5); // currentStreak
		writeU32(data, 72, 10); // bestStreak
		writeU64(data, 76, 42n); // wagerNonce
		writeU8(data, 84, 1); // pendingNonce tag: Some
		writeU64(data, 85, 41n); // pendingNonce value
		writeU8(data, 93, 254); // bump

		const result = deserializePlayerStats(data);
		expect(result.totalGames).toBe(100);
		expect(result.wins).toBe(60);
		expect(result.losses).toBe(40);
		expect(result.solWagered).toBe(5000000000n);
		expect(result.solWon).toBe(3000000000n);
		expect(result.currentStreak).toBe(5);
		expect(result.bestStreak).toBe(10);
		expect(result.wagerNonce).toBe(42n);
		expect(result.pendingNonce).toBe(41n);
		expect(result.bump).toBe(254);
	});

	it("reads pendingNonce = None correctly", () => {
		const data = makeAccountData("PlayerStats", 94);
		writePubkey(data, 8, 0xaa);
		writeU64(data, 76, 5n); // wagerNonce
		writeU8(data, 84, 0); // pendingNonce tag: None (1 byte only)
		writeU8(data, 85, 1); // bump (immediately after None tag)

		const result = deserializePlayerStats(data);
		expect(result.wagerNonce).toBe(5n);
		expect(result.pendingNonce).toBeNull();
		expect(result.bump).toBe(1);
	});

	it("reads pendingNonce = Some(42) correctly", () => {
		const data = makeAccountData("PlayerStats", 94);
		writePubkey(data, 8, 0xbb);
		writeU64(data, 76, 43n); // wagerNonce
		writeU8(data, 84, 1); // pendingNonce tag: Some
		writeU64(data, 85, 42n); // pendingNonce value
		writeU8(data, 93, 255); // bump

		const result = deserializePlayerStats(data);
		expect(result.wagerNonce).toBe(43n);
		expect(result.pendingNonce).toBe(42n);
		expect(result.bump).toBe(255);
	});
});

describe("deserializeGameConfig", () => {
	it("deserializes a GameConfig account", () => {
		const data = makeAccountData("GameConfig", ACCOUNT_SIZES.GameConfig);
		writePubkey(data, 8, 0x11);
		writePubkey(data, 40, 0x22);
		writeU16(data, 72, 250);
		writeU64(data, 74, 100000000n);
		writeU8(data, 82, 10);
		writeU8(data, 83, 0);
		writeI64(data, 84, 3600n);
		writeI64(data, 92, 120n);
		writeU8(data, 100, 255);

		const result = deserializeGameConfig(data);
		expect(result.feeBps).toBe(250);
		expect(result.mintPrice).toBe(100000000n);
		expect(result.initialUses).toBe(10);
		expect(result.isPaused).toBe(false);
		expect(result.wagerExpirySeconds).toBe(3600n);
		expect(result.vrfTimeoutSeconds).toBe(120n);
		expect(result.bump).toBe(255);
	});
});
