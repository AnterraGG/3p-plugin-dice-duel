/**
 * DiceDuel SVM Shared Module
 *
 * Deserialization and account types for the DiceDuel Anchor program.
 * Importable by both client hooks and the SVM indexer.
 */

export {
	DISCRIMINATORS,
	DISCRIMINATORS_HEX,
	ACCOUNT_SIZES,
	deserializeDiceBag,
	deserializeWager,
	deserializePlayerStats,
	deserializeGameConfig,
	identifyAccountType,
} from "./deserialize";

export type {
	WagerStatus,
	DeserializedDiceBag,
	DeserializedWager,
	DeserializedPlayerStats,
	DeserializedGameConfig,
} from "./deserialize";
