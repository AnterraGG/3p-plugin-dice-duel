import { describe, expect, it } from "vitest";
import { getHighLowDicePair, getParityMatchedDicePair } from "../dice-faces";

describe("getHighLowDicePair", () => {
	it("returns values in range 1-6 for all results 0-99", () => {
		for (let result = 0; result < 100; result++) {
			const [d1, d2] = getHighLowDicePair(result);
			expect(d1).toBeGreaterThanOrEqual(1);
			expect(d1).toBeLessThanOrEqual(6);
			expect(d2).toBeGreaterThanOrEqual(1);
			expect(d2).toBeLessThanOrEqual(6);
		}
	});

	it("low results (0-49) produce sum 2-7", () => {
		for (let result = 0; result < 50; result++) {
			const [d1, d2] = getHighLowDicePair(result);
			const sum = d1 + d2;
			expect(sum).toBeGreaterThanOrEqual(2);
			expect(sum).toBeLessThanOrEqual(7);
		}
	});

	it("high results (50-99) produce sum 7-12", () => {
		for (let result = 50; result < 100; result++) {
			const [d1, d2] = getHighLowDicePair(result);
			const sum = d1 + d2;
			expect(sum).toBeGreaterThanOrEqual(7);
			expect(sum).toBeLessThanOrEqual(12);
		}
	});

	it("boundary: result 0 → lowest sum (2)", () => {
		const [d1, d2] = getHighLowDicePair(0);
		expect(d1 + d2).toBe(2);
	});

	it("boundary: result 99 → highest sum (12)", () => {
		const [d1, d2] = getHighLowDicePair(99);
		expect(d1 + d2).toBe(12);
	});

	it("is deterministic", () => {
		for (let result = 0; result < 100; result++) {
			expect(getHighLowDicePair(result)).toEqual(getHighLowDicePair(result));
		}
	});
});

describe("getParityMatchedDicePair", () => {
	it("returns values in range 1-6 for all results 0-99", () => {
		for (let result = 0; result < 100; result++) {
			const [d1, d2] = getParityMatchedDicePair(result);
			expect(d1).toBeGreaterThanOrEqual(1);
			expect(d1).toBeLessThanOrEqual(6);
			expect(d2).toBeGreaterThanOrEqual(1);
			expect(d2).toBeLessThanOrEqual(6);
		}
	});

	it("sum parity matches result parity for all results 0-99", () => {
		for (let result = 0; result < 100; result++) {
			const [d1, d2] = getParityMatchedDicePair(result);
			expect((d1 + d2) % 2).toBe(result % 2);
		}
	});

	it("is deterministic", () => {
		for (let result = 0; result < 100; result++) {
			expect(getParityMatchedDicePair(result)).toEqual(
				getParityMatchedDicePair(result),
			);
		}
	});
});
