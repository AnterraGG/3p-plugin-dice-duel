import {
	definePluginChains,
	requireSvmCluster,
} from "@townexchange/3p-plugin-sdk/shared";

export const DRAGON_DICE_SVM_CLUSTER = "devnet" as const;

export const dragonDiceChains = definePluginChains({
	required: [
		requireSvmCluster(DRAGON_DICE_SVM_CLUSTER, {
			name: "Solana Devnet",
		}),
	],
	primaryFamily: "svm",
	supportsDynamicChains: false,
});
