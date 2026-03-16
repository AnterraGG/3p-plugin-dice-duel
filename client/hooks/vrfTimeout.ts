/**
 * getVrfTimeoutState — Shared VRF timeout state for wagers.
 *
 * Pure function (not a React hook — no state, effects, or hook calls).
 *
 * We do NOT attempt a client-side countdown for Active wagers because
 * `createdAt` is stamped when the challenger *initiates* the wager, not
 * when the opponent accepts. Any heuristic based on createdAt can produce
 * false-positive timeouts. Instead we show a neutral "Awaiting VRF..."
 * for Active wagers and only surface timeout UI when the on-chain status
 * is explicitly `VrfTimeout`.
 */

import type { SvmWager } from "../api";

export interface VrfTimeoutResult {
	/** True when on-chain status is explicitly VrfTimeout */
	isVrfTimeout: boolean;
	/** True when the wager is Active (awaiting VRF result) */
	isActive: boolean;
}

export function getVrfTimeoutState(wager: SvmWager): VrfTimeoutResult {
	return {
		isVrfTimeout: wager.status === "VrfTimeout",
		isActive: wager.status === "Active",
	};
}
