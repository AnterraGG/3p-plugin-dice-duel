export {
	useSvmInventoryWagers,
	useSvmWagerHistory,
	useSvmWagerDetail,
	useSvmDiceBags,
	useSvmPlayerStats,
	useSvmGameConfig,
	queryKeys,
} from "./queries-indexed";
export { usePriorityFees } from "@townexchange/3p-plugin-sdk/client";
export { decodeDiceDuelError, logDiceDuelError } from "./errors";
export type { DecodedAnchorError } from "./errors";
