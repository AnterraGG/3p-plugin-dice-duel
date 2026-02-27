/**
 * Token formatting and parsing utilities for Dice Duel.
 *
 * SVM-only — supports SOL token.
 */

import { formatUnits, parseUnits } from "@townexchange/3p-plugin-sdk/shared";
import { SUPPORTED_TOKENS, type SupportedTokenSymbol } from "./constants";

/**
 * Get token decimals from a symbol string.
 */
export function getTokenDecimals(symbol: string): number {
	const upper = symbol.toUpperCase();
	if (upper in SUPPORTED_TOKENS) {
		return SUPPORTED_TOKENS[upper as SupportedTokenSymbol].decimals;
	}
	// Default to 9 (SOL)
	return 9;
}

/**
 * Resolve a token symbol string to a canonical SupportedTokenSymbol.
 */
export function getTokenSymbol(symbol: string): SupportedTokenSymbol {
	const upper = symbol.toUpperCase();
	if (upper in SUPPORTED_TOKENS) {
		return upper as SupportedTokenSymbol;
	}
	return "SOL";
}

/**
 * Format a raw token amount (lamports/wei) to human-readable string.
 */
export function formatTokenAmount(
	amountRaw: bigint,
	tokenSymbolOrAddress: string,
): string {
	const decimals = getTokenDecimals(tokenSymbolOrAddress);
	return formatUnits(amountRaw, decimals);
}

/**
 * Parse a human-readable amount to raw units (lamports/wei).
 */
export function parseTokenAmount(
	amount: string,
	tokenSymbolOrAddress: string,
): bigint {
	const decimals = getTokenDecimals(tokenSymbolOrAddress);
	return parseUnits(amount, decimals);
}
