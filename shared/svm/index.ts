/**
 * DiceDuel SVM Shared Module
 *
 * Program descriptor, deserialized account types, and PDA helpers
 * for the DiceDuel Anchor program. Importable by both client hooks
 * and the SVM indexer.
 */

export {
	diceDuelProgram,
	type WagerStatus,
	type DeserializedDiceBag,
	type DeserializedWager,
	type DeserializedPlayerStats,
	type DeserializedGameConfig,
} from "./program";
