export {
	fetchSvmDiceBags,
	fetchSvmPlayerStats,
	fetchSvmGameConfig,
	fetchInventoryWagers,
	fetchWagerHistory,
	fetchWagerDetail,
} from "./svmApi";

export type {
	SvmWager,
	SvmDiceBag,
	SvmPlayerStats,
	SvmGameConfig,
	SvmWagerStatus,
	SvmWagerCompact,
	SvmInventoryWagersResponse,
	SvmWagerHistoryResponse,
} from "../../shared/indexing-svm/types";
