/**
 * Wager utility functions — shared between indexing handlers and API.
 */

/**
 * Compute the expiration timestamp for a wager.
 *
 * @param createdAt - Unix epoch seconds when the wager was created
 * @param expirySeconds - Duration in seconds until the wager expires
 * @returns Unix epoch seconds when the wager expires
 */
export function computeExpiresAt(
	createdAt: bigint,
	expirySeconds: bigint,
): bigint {
	return createdAt + expirySeconds;
}
