import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../pagination";

describe("DiceDuel cursor (SDK-backed)", () => {
	it("round-trips correctly (desc default)", () => {
		const encoded = encodeCursor(
			1700000000n,
			"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
		);
		const decoded = decodeCursor(encoded);
		expect(decoded).toEqual({
			createdAt: 1700000000n,
			address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
			sort: "desc",
		});
	});

	it("round-trips correctly (asc)", () => {
		const encoded = encodeCursor(1700000000n, "addr", "asc");
		const decoded = decodeCursor(encoded);
		expect(decoded).toEqual({
			createdAt: 1700000000n,
			address: "addr",
			sort: "asc",
		});
	});

	it("returns null for invalid cursor", () => {
		expect(decodeCursor("not-valid-base64!!!")).toBeNull();
	});

	it("returns null for malformed JSON", () => {
		const encoded = Buffer.from("{}").toString("base64url");
		expect(decodeCursor(encoded)).toBeNull();
	});

	it("handles zero createdAt", () => {
		const encoded = encodeCursor(0n, "addr");
		const decoded = decodeCursor(encoded);
		expect(decoded).toEqual({ createdAt: 0n, address: "addr", sort: "desc" });
	});

	it("produces URL-safe string", () => {
		const encoded = encodeCursor(
			999999999999n,
			"SomeAddress123456789012345678901234567890123",
		);
		expect(encoded).not.toMatch(/[+/=]/);
	});

	it("defaults unknown sort values to desc", () => {
		// Manually craft a cursor with bad sort
		const bad = Buffer.from(
			JSON.stringify({
				v: 1,
				f: { createdAt: "100", address: "a" },
				s: "random",
			}),
		).toString("base64url");
		const decoded = decodeCursor(bad);
		expect(decoded?.sort).toBe("desc");
	});

	it("rejects legacy v0 cursors (no version field)", () => {
		const legacy = Buffer.from(
			JSON.stringify({ c: "1700000000", a: "addr" }),
		).toString("base64url");
		expect(decodeCursor(legacy)).toBeNull();
	});
});
