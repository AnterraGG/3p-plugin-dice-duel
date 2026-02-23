/**
 * Dragon Dice ECS Module (3p SDK version)
 *
 * Import change: defineECSModule, alwaysActive from 3p-plugin-sdk/client
 */

import {
	alwaysActive,
	defineECSModule,
} from "@townexchange/3p-plugin-sdk/client";
import { clearDragonDiceVisuals } from "../state";
import { useDragonDiceGameStore } from "../store/dragonDiceGameStore";
import { createBalanceFloatRenderSystem } from "../systems/BalanceFloatRenderSystem";
import { createCelebrationRenderSystem } from "../systems/CelebrationRenderSystem";
import { createChallengeIndicatorSystem } from "../systems/ChallengeIndicatorSystem";
import { createDiceRollRenderSystem } from "../systems/DiceRollRenderSystem";

export const DragonDiceModule = defineECSModule({
	id: "dragon-dice-effects",
	name: "Dragon Dice Effects",
	version: "1.0.0",

	state: {
		create: () => ({ initialized: true }),
		dispose: () => {
			clearDragonDiceVisuals();
			useDragonDiceGameStore.getState().clearAll();
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
			clearDragonDiceVisuals();
			useDragonDiceGameStore.getState().clearAll();
		},
	},
});
