import {
	definePluginChains,
	requireSvmCluster,
} from "@townexchange/3p-plugin-sdk/shared";

export const DICE_DUEL_SVM_CLUSTER = "devnet" as const;

export const diceDuelChains = definePluginChains({
	required: [
		requireSvmCluster(DICE_DUEL_SVM_CLUSTER, {
			name: "Solana Devnet",
		}),
	],
	primaryFamily: "svm",
	supportsDynamicChains: false,
});
