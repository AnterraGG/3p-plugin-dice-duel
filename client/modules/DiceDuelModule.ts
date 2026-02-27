/**
 * Dice Duel ECS Module (3p SDK version)
 *
 * Import change: defineECSModule, alwaysActive from 3p-plugin-sdk/client
 */

import {
	alwaysActive,
	defineECSModule,
} from "@townexchange/3p-plugin-sdk/client";
import { clearDiceDuelVisuals } from "../state";
import { useDiceDuelGameStore } from "../store/diceDuelGameStore";
import { createBalanceFloatRenderSystem } from "../systems/BalanceFloatRenderSystem";
import { createCelebrationRenderSystem } from "../systems/CelebrationRenderSystem";
import { createChallengeIndicatorSystem } from "../systems/ChallengeIndicatorSystem";
import { createDiceRollRenderSystem } from "../systems/DiceRollRenderSystem";

export const DiceDuelModule = defineECSModule({
	id: "dice-duel-effects",
	name: "Dice Duel Effects",
	version: "1.0.0",

	state: {
		create: () => ({ initialized: true }),
		dispose: () => {
			clearDiceDuelVisuals();
			useDiceDuelGameStore.getState().clearAll();
		},
	},

	systems: [
		{
			fn: createChallengeIndicatorSystem(),
			phase: "render",
			priority: 100,
			browserOnly: true,
		},
		{
			fn: createDiceRollRenderSystem(),
			phase: "render",
			priority: 101,
			browserOnly: true,
		},
		{
			fn: createCelebrationRenderSystem(),
			phase: "render",
			priority: 102,
			browserOnly: true,
		},
		{
			fn: createBalanceFloatRenderSystem(),
			phase: "render",
			priority: 103,
			browserOnly: true,
		},
	],

	activation: alwaysActive(),

	hooks: {
		onDeactivate: () => {
			clearDiceDuelVisuals();
			useDiceDuelGameStore.getState().clearAll();
		},
	},
});
