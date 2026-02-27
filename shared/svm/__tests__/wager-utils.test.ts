import { describe, expect, it } from "vitest";
import { computeExpiresAt } from "../wager-utils";

describe("computeExpiresAt", () => {
	it("adds expirySeconds to createdAt", () => {
		const result = computeExpiresAt(1000n, 3600n);
		expect(result).toBe(4600n);
	});

	it("handles zero createdAt", () => {
		expect(computeExpiresAt(0n, 3600n)).toBe(3600n);
	});

	it("handles large timestamps", () => {
		const createdAt = 1700000000n;
		const expiry = 7200n;
		expect(computeExpiresAt(createdAt, expiry)).toBe(1700007200n);
	});
});
