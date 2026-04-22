/**
 * Dice Duel Plugin Manifest (3p SDK version)
 */

import {
	defineManifest,
	eventChannels,
	svmCapabilities,
} from "@anterra/3p-plugin-sdk/shared";
import type { DiceDuelEventMap } from "./event-data";
import { programs } from "./programs";

export const manifest = defineManifest({
	id: "dice-duel",
	version: "2.0.0",
	name: "Dice Duel",
	description: "Dice game with wagering — SVM (Solana Devnet)",

	activationRules: [
		{ type: "map-property-value", property: "gameType", value: "dice" },
	],

	sdkVersion: "^2.0.0",

	packets: {
		server: { start: 120, end: 139 },
	},

	onchain: {
		walletRead: true,
		eventChannels: eventChannels<DiceDuelEventMap>(
			"wager_initiated",
			"wager_accepted",
			"wager_cancelled",
			"wager_resolved",
			"winnings_claimed",
			"wager_expired",
			"vrf_timeout_claimed",
			"dice_bag_minted",
			"dice_bag_updated",
			"config_updated",
		),

		svm: svmCapabilities({
			programs,
			allowedInstructions: {
				DiceDuel: [
					"initialize",
					"mint_dice_bag",
					"initiate_wager",
					"cancel_wager",
					"accept_wager",
					"claim_vrf_timeout",
					"claim_expired",
				],
			},
			sessionKeyAccess: true,
			tokenLimits: [
				{
					mint: "native",
					symbol: "SOL",
					decimals: 9,
					maxPerSession: "1000000000",
					maxPerTransaction: "500000000",
				},
			],
		}),
	},
});
