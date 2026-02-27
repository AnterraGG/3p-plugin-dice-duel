/**
 * Dice Duel Game Store
 *
 * Pure Zustand store — no internal imports. Copied as-is.
 */

import { create } from "zustand";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DiceRollAnimation {
	wagerId: string;
	startTime: number;
	result: number | null;
	position: { x: number; y: number };
	state: "rolling" | "landing" | "showing" | "complete";
}

export interface CelebrationEffect {
	id: string;
	type: "win" | "lose";
	startTime: number;
	position: { x: number; y: number };
	entityId?: number;
}

export interface ChallengeIndicator {
	wagerId: string;
	challengerAddress: string;
	startTime: number;
}

export interface BalanceFloat {
	id: string;
	/** Human-readable amount, already formatted (e.g. "0.05", "100.00") */
	amount: string;
	/** Asset ticker (e.g. "SOL", "WETH", "USDC") */
	ticker: string;
	/** Optional texture key for a ticker icon sprite (must be pre-loaded) */
	tickerImage?: string;
	isPositive: boolean;
	position: { x: number; y: number };
	entityId?: number;
	startTime: number;
}

// ─── Store Interface ───────────────────────────────────────────────────────

interface DiceDuelGameStore {
	diceRolls: Map<string, DiceRollAnimation>;
	celebrations: Map<string, CelebrationEffect>;
	challengeIndicators: Map<string, ChallengeIndicator>;
	balanceFloats: Map<string, BalanceFloat>;

	startDiceRoll: (wagerId: string, position: { x: number; y: number }) => void;
	/** Store result on a rolling dice WITHOUT triggering landing — the render system lands it after DICE_ROLL_DURATION */
	setDiceResult: (wagerId: string, result: number) => void;
	landDice: (wagerId: string, result: number) => void;
	completeDiceRoll: (wagerId: string) => void;

	addCelebration: (
		type: "win" | "lose",
		position: { x: number; y: number },
		entityId?: number,
	) => void;
	removeCelebration: (id: string) => void;

	addChallengeIndicator: (wagerId: string, challengerAddress: string) => void;
	removeChallengeIndicator: (wagerId: string) => void;

	addBalanceFloat: (
		amount: string,
		ticker: string,
		isPositive: boolean,
		position: { x: number; y: number },
		tickerImage?: string,
		entityId?: number,
	) => void;
	removeBalanceFloat: (id: string) => void;

	clearAll: () => void;
}

// ─── Store Implementation ──────────────────────────────────────────────────

export const useDiceDuelGameStore = create<DiceDuelGameStore>(
	(set, _get) => ({
		diceRolls: new Map(),
		celebrations: new Map(),
		challengeIndicators: new Map(),
		balanceFloats: new Map(),

		startDiceRoll: (wagerId, position) => {
			const roll: DiceRollAnimation = {
				wagerId,
				startTime: Date.now(),
				result: null,
				position,
				state: "rolling",
			};
			set((state) => {
				const newRolls = new Map(state.diceRolls);
				newRolls.set(wagerId, roll);
				return { diceRolls: newRolls };
			});
		},

		setDiceResult: (wagerId, result) => {
			set((state) => {
				const newRolls = new Map(state.diceRolls);
				const roll = newRolls.get(wagerId);
				if (roll && roll.state === "rolling") {
					newRolls.set(wagerId, { ...roll, result });
				}
				return { diceRolls: newRolls };
			});
		},

		landDice: (wagerId, result) => {
			set((state) => {
				const newRolls = new Map(state.diceRolls);
				const roll = newRolls.get(wagerId);
				if (roll) {
					newRolls.set(wagerId, {
						...roll,
						result,
						state: "landing",
						startTime: Date.now(),
					});
				}
				return { diceRolls: newRolls };
			});
		},

		completeDiceRoll: (wagerId) => {
			set((state) => {
				const newRolls = new Map(state.diceRolls);
				newRolls.delete(wagerId);
				return { diceRolls: newRolls };
			});
		},

		addCelebration: (type, position, entityId?) => {
			const id = `celebration_${Date.now()}_${Math.random()}`;
			const celebration: CelebrationEffect = {
				id,
				type,
				startTime: Date.now(),
				position,
				entityId,
			};
			set((state) => {
				const newCelebrations = new Map(state.celebrations);
				newCelebrations.set(id, celebration);
				return { celebrations: newCelebrations };
			});
		},

		removeCelebration: (id) => {
			set((state) => {
				const newCelebrations = new Map(state.celebrations);
				newCelebrations.delete(id);
				return { celebrations: newCelebrations };
			});
		},

		addChallengeIndicator: (wagerId, challengerAddress) => {
			const indicator: ChallengeIndicator = {
				wagerId,
				challengerAddress,
				startTime: Date.now(),
			};
			set((state) => {
				const newIndicators = new Map(state.challengeIndicators);
				newIndicators.set(wagerId, indicator);
				return { challengeIndicators: newIndicators };
			});
		},

		removeChallengeIndicator: (wagerId) => {
			set((state) => {
				const newIndicators = new Map(state.challengeIndicators);
				newIndicators.delete(wagerId);
				return { challengeIndicators: newIndicators };
			});
		},

		addBalanceFloat: (
			amount,
			ticker,
			isPositive,
			position,
			tickerImage,
			entityId?,
		) => {
			const id = `balance_float_${Date.now()}_${Math.random()}`;
			const float: BalanceFloat = {
				id,
				amount,
				ticker,
				tickerImage,
				isPositive,
				position,
				entityId,
				startTime: Date.now(),
			};
			set((state) => {
				const newFloats = new Map(state.balanceFloats);
				newFloats.set(id, float);
				return { balanceFloats: newFloats };
			});
		},

		removeBalanceFloat: (id) => {
			set((state) => {
				const newFloats = new Map(state.balanceFloats);
				newFloats.delete(id);
				return { balanceFloats: newFloats };
			});
		},

		clearAll: () => {
			set({
				diceRolls: new Map(),
				celebrations: new Map(),
				challengeIndicators: new Map(),
				balanceFloats: new Map(),
			});
		},
	}),
);
