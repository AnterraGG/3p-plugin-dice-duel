/**
 * Dragon Dice SVM Program Definitions
 *
 * DiceDuel Anchor program — peer-to-peer dice wagering on Solana.
 * Uses MagicBlock VRF for verifiable randomness.
 */

import { definePluginPrograms } from "@townexchange/3p-plugin-sdk/shared";
import { DICE_DUEL_PROGRAM_ADDRESS } from "#generated/clients/svm/dice-duel/programs";
import DiceDuelIDL from "../../generated/idl/dice_duel.json";

export const DICE_DUEL_PROGRAM_ID = DICE_DUEL_PROGRAM_ADDRESS as string;

export const programs = definePluginPrograms({
	DiceDuel: {
		idl: DiceDuelIDL,
		deployments: {
			devnet: {
				programId: DICE_DUEL_PROGRAM_ID,
				startSlot: 0,
			},
		},
	},
} as const);
