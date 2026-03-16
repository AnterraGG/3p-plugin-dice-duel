/**
 * SVM Indexer-Backed Query Hooks
 *
 * All data flows through the injected IndexerApiClient.
 * Query keys use `createPluginQueryKeys` for namespaced, prefix-matchable keys.
 * Freshness is driven by notification-based invalidation via ctx.queries.
 */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	createPluginQueryKeys,
	usePluginIndexerApi,
	usePluginSvmTransaction,
} from "@townexchange/3p-plugin-sdk/client";
import {
	fetchInventoryWagers,
	fetchSvmDiceBags,
	fetchSvmGameConfig,
	fetchSvmLeaderboard,
	fetchSvmPlayerStats,
	fetchWagerDetail,
	fetchWagerHistory,
} from "../../api/svmApi";

const LOG = "[DiceDuel:Query]";

/**
 * Namespaced query key factory (SDK Phase 5).
 * Replaces ad-hoc SVM_QUERY_KEYS with plugin-prefixed keys.
 */
export const queryKeys = createPluginQueryKeys("dice-duel", {
	inventoryWagers: (address: string) => ({ address }),
	wagerHistory: (address: string) => ({ address }),
	wagerDetail: (wagerAddress: string) => ({ wagerAddress }),
	diceBags: (address: string) => ({ address }),
	playerStats: (address: string) => ({ address }),
	gameConfig: () => ({}),
	leaderboard: (limit: number) => ({ limit }),
});

// ── New optimized hooks ────────────────────────────────────────────────────

/**
 * Fetch inventory wagers — actionable (full) + 5 recent history (compact).
 * Replaces useSvmWagers() in SvmInventory.
 */
export function useSvmInventoryWagers() {
	const { walletAddress } = usePluginSvmTransaction();
	const api = usePluginIndexerApi("svm");

	const query = useQuery({
		queryKey: walletAddress
			? queryKeys.inventoryWagers(walletAddress)
			: ["svm-inventory-wagers"],
		queryFn: async () => {
			if (!walletAddress) throw new Error("No wallet address");
			console.log(
				`${LOG} fetching inventory wagers for ${walletAddress.slice(0, 8)}...`,
			);
			const result = await fetchInventoryWagers(api, walletAddress);
			console.log(
				`${LOG} inventory loaded — in:${result.summary.incomingCount} out:${result.summary.outgoingCount} active:${result.summary.activeCount} claim:${result.summary.claimableCount} history:${result.recentHistory.length}/${result.totalHistoryCount}`,
			);
			return result;
		},
		enabled: Boolean(walletAddress),
		staleTime: 10_000,
		refetchInterval: 15_000,
	});

	if (query.error) {
		console.error(`${LOG} inventory wagers fetch error:`, query.error);
	}

	const actionable = query.data?.actionable;

	return {
		incoming: actionable?.incoming ?? [],
		outgoing: actionable?.outgoing ?? [],
		active: actionable?.active ?? [],
		claimable: actionable?.claimable ?? [],
		resolved: actionable?.resolved ?? [],
		vrfTimeout: actionable?.vrfTimeout ?? [],
		recentHistory: query.data?.recentHistory ?? [],
		totalHistoryCount: query.data?.totalHistoryCount ?? 0,
		summary: query.data?.summary ?? {
			incomingCount: 0,
			outgoingCount: 0,
			activeCount: 0,
			claimableCount: 0,
			totalActionableCount: 0,
		},
		isLoading: query.isLoading,
		error: query.error,
		refetch: query.refetch,
	};
}

/**
 * Paginated wager history — cursor-based infinite query.
 * Used in SvmWagerHistoryContent.
 */
export function useSvmWagerHistory(pageSize = 20) {
	const { walletAddress } = usePluginSvmTransaction();
	const api = usePluginIndexerApi("svm");

	return useInfiniteQuery({
		queryKey: walletAddress
			? queryKeys.wagerHistory(walletAddress)
			: ["svm-wager-history"],
		queryFn: async ({ pageParam }) => {
			if (!walletAddress) throw new Error("No wallet address");
			console.log(
				`${LOG} fetching wager history page for ${walletAddress.slice(0, 8)}... cursor=${pageParam ? "yes" : "none"}`,
			);
			const result = await fetchWagerHistory(api, walletAddress, {
				limit: pageSize,
				cursor: pageParam ?? undefined,
			});
			console.log(
				`${LOG} history page loaded — ${result.wagers.length} wagers, hasMore=${result.hasMore}`,
			);
			return result;
		},
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) => lastPage.nextCursor,
		enabled: Boolean(walletAddress),
		staleTime: 30_000,
		refetchInterval: 60_000,
	});
}

/**
 * Fetch a single wager's full details — for detail modals.
 */
export function useSvmWagerDetail(wagerAddress: string | null | undefined) {
	const api = usePluginIndexerApi("svm");

	return useQuery({
		queryKey: wagerAddress
			? queryKeys.wagerDetail(wagerAddress)
			: ["svm-wager-detail"],
		queryFn: async () => {
			if (!wagerAddress) throw new Error("No wager address");
			console.log(
				`${LOG} fetching wager detail for ${wagerAddress.slice(0, 8)}...`,
			);
			return fetchWagerDetail(api, wagerAddress);
		},
		enabled: Boolean(wagerAddress),
		staleTime: 60_000,
	});
}

/**
 * Fetch all dice bags owned by the connected SVM wallet.
 */
export function useSvmDiceBags() {
	const { walletAddress } = usePluginSvmTransaction();
	const api = usePluginIndexerApi("svm");

	return useQuery({
		queryKey: walletAddress
			? queryKeys.diceBags(walletAddress)
			: ["svm-dice-bags"],
		queryFn: async () => {
			if (!walletAddress) throw new Error("No wallet address");
			console.log(
				`${LOG} fetching dice bags for ${walletAddress.slice(0, 8)}...`,
			);
			const result = await fetchSvmDiceBags(api, walletAddress);
			const bags = result.diceBags;
			console.log(
				`${LOG} dice bags loaded — ${bags.length} bags, ${bags.filter((b) => b.usesRemaining > 0).length} with uses`,
				bags.map((b) => ({
					mint: `${b.mint.slice(0, 6)}...`,
					owner: `${b.owner.slice(0, 6)}...`,
					uses: b.usesRemaining,
				})),
			);
			return result;
		},
		enabled: Boolean(walletAddress),
		staleTime: 10_000,
		refetchInterval: 30_000,
	});
}

/**
 * Fetch player stats for the connected SVM wallet.
 */
export function useSvmPlayerStats() {
	const { walletAddress } = usePluginSvmTransaction();
	const api = usePluginIndexerApi("svm");

	return useQuery({
		queryKey: walletAddress
			? queryKeys.playerStats(walletAddress)
			: ["svm-player-stats"],
		queryFn: async () => {
			if (!walletAddress) throw new Error("No wallet address");
			console.log(`${LOG} fetching stats for ${walletAddress.slice(0, 8)}...`);
			const result = await fetchSvmPlayerStats(api, walletAddress);
			if (result.stats) {
				console.log(`${LOG} stats:`, result.stats);
			} else {
				console.log(
					`${LOG} no stats found for ${walletAddress.slice(0, 8)}...`,
				);
			}
			return result;
		},
		enabled: Boolean(walletAddress),
		staleTime: 10_000,
		refetchInterval: 30_000,
	});
}

/**
 * Fetch the global DiceDuel game configuration.
 */
export function useSvmGameConfig() {
	const api = usePluginIndexerApi("svm");

	return useQuery({
		queryKey: queryKeys.gameConfig(),
		queryFn: async () => {
			console.log(`${LOG} fetching game config`);
			const result = await fetchSvmGameConfig(api);
			console.log(`${LOG} config:`, result.config);
			return result;
		},
		staleTime: 60_000,
	});
}

/**
 * Fetch the global leaderboard — top players sorted by wins (desc).
 */
export function useSvmGlobalLeaderboard(limit = 20) {
	const api = usePluginIndexerApi("svm");

	return useQuery({
		queryKey: queryKeys.leaderboard(limit),
		queryFn: () => fetchSvmLeaderboard(api, { limit }),
		staleTime: 30_000,
		refetchInterval: 60_000,
	});
}
