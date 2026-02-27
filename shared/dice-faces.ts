/**
 * HIGH/LOW game: Map a VRF result (0-99) to two d6 faces whose sum
 * visually represents whether the roll was high or low.
 *
 *   Low  (result 0-49)  → sum 2-7
 *   High (result 50-99) → sum 7-12
 *
 * The result is spread across the range so different VRF values
 * produce different sums. Deterministic for a given result.
 */
export function getHighLowDicePair(result: number): [number, number] {
	const isHigh = result >= 50;
	const rangeResult = isHigh ? result - 50 : result; // 0-49

	// Map 0-49 → 6 sum buckets (0-5 offset)
	const sumOffset = Math.min(Math.floor((rangeResult * 6) / 50), 5);
	const sum = (isHigh ? 7 : 2) + sumOffset;

	// Decompose sum into two d6 faces with variety based on result
	const minD1 = Math.max(1, sum - 6);
	const maxD1 = Math.min(6, sum - 1);
	const numPairs = maxD1 - minD1 + 1;
	const d1 = minD1 + (result % numPairs);
	const d2 = sum - d1;

	return [d1, d2];
}

/**
 * ODD/EVEN game: Pick two d6 faces whose sum parity (odd/even)
 * matches the VRF result's parity.
 *
 *   VRF even → even sum,  VRF odd → odd sum
 *
 * Deterministic for a given result.
 */
export function getParityMatchedDicePair(result: number): [number, number] {
	const d1 = (result % 6) + 1;
	let d2 = (Math.floor(result / 6) % 6) + 1;
	if ((d1 + d2) % 2 !== result % 2) {
		d2 = d2 >= 6 ? d2 - 1 : d2 + 1;
	}
	return [d1, d2];
}
