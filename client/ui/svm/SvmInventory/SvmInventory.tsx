/**
 * SvmInventory — SVM-specific inventory panel for Dice Duel.
 *
 * Orchestrates hooks and passes data/handlers to presentation components.
 * All network queries live here — sub-components are pure presentation.
 */

import {
	usePluginIdentity,
	usePluginSvmTransaction,
	usePluginWindows,
} from "@anterra/3p-plugin-sdk/client";
import {
	Button,
	Flex,
	Panel,
	Stack,
	StatusBox,
	Typography,
	useContextMenu,
	useSelectionStore,
} from "@anterra/tex-ui-kit";
import type React from "react";
import { useCallback, useState } from "react";
import type { SvmDiceBag, SvmWager, SvmWagerCompact } from "../../../api";
import {
	useSvmDiceBags,
	useSvmInventoryWagers,
	useSvmPlayerStats,
} from "../../../hooks/svm/queries-indexed";
import { useDiceDuelSvm } from "../../../hooks/svm/useDiceDuelSvm";
import {
	DD_INCOMING_WAGER,
	DD_INITIATE_WAGER,
	DD_LEADERBOARD,
	DD_SHOP,
	DD_WAGER_DETAILS,
	DD_WAGER_HISTORY,
} from "../../../window-keys";
import { DiceBagsSection } from "./DiceBagsSection";
import { HistorySection } from "./HistorySection";
import styles from "./SvmInventory.module.scss";
import { WagerListSection } from "./WagerListSection";

interface SvmInventoryProps {
	className?: string;
}

export const SvmInventory: React.FC<SvmInventoryProps> = ({ className }) => {
	const { walletAddress } = usePluginSvmTransaction();
	const { open: openContextMenu } = useContextMenu();
	const startSelection = useSelectionStore((s) => s.startSelection);
	const { getUsernameBySvmAddress } = usePluginIdentity();
	const pluginWindows = usePluginWindows();

	const [collapsedSections, setCollapsedSections] = useState<
		Record<string, boolean>
	>({
		history: true,
	});

	const {
		incoming,
		outgoing,
		active,
		claimable,
		recentHistory,
		totalHistoryCount,
		isLoading: wagersLoading,
	} = useSvmInventoryWagers();

	const { data: statsData } = useSvmPlayerStats();
	const { cancelWager } = useDiceDuelSvm();
	const { data: diceBagsData, isLoading: diceBagsLoading } = useSvmDiceBags();

	// Detect stuck pendingNonce: on-chain says there's a pending wager but indexer has none.
	const pendingNonce =
		statsData?.stats?.pendingNonce != null
			? BigInt(statsData.stats.pendingNonce)
			: null;
	const hasStuckPendingWager =
		pendingNonce !== null && outgoing.length === 0 && !wagersLoading;

	const diceBags = diceBagsData?.diceBags ?? [];
	const activeBags = diceBags.filter((b) => b.usesRemaining > 0);
	const depletedBags = diceBags.filter((b) => b.usesRemaining <= 0);
	const isLoading = wagersLoading || diceBagsLoading;

	// ── Handlers ──────────────────────────────────────────────────────────────

	const handleCancelStuckWager = useCallback(async () => {
		if (pendingNonce === null) return;
		try {
			await cancelWager.execute({ nonce: pendingNonce });
		} catch (e) {
			console.error("[SvmInventory] Failed to cancel stuck wager:", e);
		}
	}, [pendingNonce, cancelWager]);

	const startDiceSelection = useCallback(
		(bag: SvmDiceBag) => {
			startSelection({
				mode: "player-wager",
				source: { type: "dice", id: bag.mint },
				validTargetTypes: ["player"],
				tooltips: {
					instruction: "Click a player to challenge",
					hoverTemplate: (name) => [
						{ text: "Challenge " },
						{ text: name, highlight: true },
					],
				},
				onComplete: (target) => {
					pluginWindows.open(DD_INITIATE_WAGER, {
						opponentAddress: target.data?.svmAddress as string | undefined,
						opponentName: target.data?.displayName as string | undefined,
						diceBagMint: bag.mint,
					});
				},
			});
		},
		[startSelection, pluginWindows],
	);

	const handleDiceLeftClick = useCallback(
		(bag: SvmDiceBag) => {
			if (bag.usesRemaining <= 0) return;
			startDiceSelection(bag);
		},
		[startDiceSelection],
	);

	const handleDiceRightClick = useCallback(
		(bag: SvmDiceBag) => (event: React.MouseEvent) => {
			event.preventDefault();
			const mintShort = `${bag.mint.slice(0, 4)}...${bag.mint.slice(-4)}`;
			openContextMenu({
				x: event.clientX,
				y: event.clientY,
				title: `Dice Bag ${mintShort}`,
				items: [
					{
						id: "select-player-wager",
						label: "Select Player to Wager",
						onClick: () => startDiceSelection(bag),
						disabled: bag.usesRemaining <= 0,
					},
				],
			});
		},
		[openContextMenu, startDiceSelection],
	);

	const handleBuyClick = useCallback(() => {
		pluginWindows.open(DD_SHOP);
	}, [pluginWindows]);

	const handleWagerClick = useCallback(
		(wager: SvmWager) => {
			const isChallenger =
				wager.challenger.toLowerCase() === walletAddress!.toLowerCase();

			if (wager.status === "Pending" && !isChallenger) {
				pluginWindows.open(DD_INCOMING_WAGER, { wager });
			} else {
				pluginWindows.open(DD_WAGER_DETAILS, { wager });
			}
		},
		[walletAddress, pluginWindows],
	);

	const handleWagerRightClick = useCallback(
		(wager: SvmWager) => (event: React.MouseEvent) => {
			event.preventDefault();
			const addrShort = `${wager.address.slice(0, 4)}...${wager.address.slice(-4)}`;
			const isChallenger =
				wager.challenger.toLowerCase() === walletAddress!.toLowerCase();
			const menuItems = [
				{
					id: "view-details",
					label: "View Details",
					onClick: () => pluginWindows.open(DD_WAGER_DETAILS, { wager }),
				},
			];

			if (wager.status === "Pending" && !isChallenger) {
				menuItems.unshift({
					id: "accept",
					label: "Accept Wager",
					onClick: () => pluginWindows.open(DD_INCOMING_WAGER, { wager }),
				});
			}

			openContextMenu({
				x: event.clientX,
				y: event.clientY,
				title: `Wager ${addrShort}`,
				items: menuItems,
			});
		},
		[walletAddress, pluginWindows, openContextMenu],
	);

	const handleHistoryItemClick = useCallback(
		(wager: SvmWager | SvmWagerCompact) => {
			pluginWindows.open(DD_WAGER_DETAILS, { wager });
		},
		[pluginWindows],
	);

	const handleViewAllHistory = useCallback(() => {
		pluginWindows.open(DD_WAGER_HISTORY);
	}, [pluginWindows]);

	const toggleSection = useCallback((section: string) => {
		setCollapsedSections((prev) => ({
			...prev,
			[section]: !prev[section],
		}));
	}, []);

	// ── Early returns ─────────────────────────────────────────────────────────

	if (!walletAddress) {
		return (
			<Panel padding="compact" className={className} style={{ width: 220 }}>
				<Stack gap={2}>
					<Typography variant="gold" size="sm">
						Dice Duel
					</Typography>
					<Typography
						variant="muted"
						size="xs"
						style={{ textAlign: "center", padding: 8 }}
					>
						Connect wallet to view inventory
					</Typography>
				</Stack>
			</Panel>
		);
	}

	return (
		<Panel padding="compact" className={className} style={{ width: 220 }}>
			<Stack gap={2}>
				<Flex justify="between" align="center">
					<Typography variant="gold" size="sm">
						Dice Duel
					</Typography>
					<button
						type="button"
						className={styles.viewAllLink}
						onClick={() => pluginWindows.open(DD_LEADERBOARD)}
					>
						Leaderboard
					</button>
				</Flex>

				{hasStuckPendingWager && (
					<StatusBox variant="error">
						<Stack gap={2}>
							<Typography variant="error" size="xs">
								Pending wager #{pendingNonce!.toString()} not found. Cancel it
								to create new wagers.
							</Typography>
							<Button
								size="sm"
								variant="secondary"
								width="full"
								onClick={handleCancelStuckWager}
								disabled={cancelWager.isPending}
							>
								{cancelWager.isPending ? "Cancelling..." : "Cancel Stuck Wager"}
							</Button>
						</Stack>
					</StatusBox>
				)}

				{isLoading ? (
					<Typography variant="muted" size="xs">
						Loading...
					</Typography>
				) : (
					<Stack gap={2}>
						<DiceBagsSection
							activeBags={activeBags}
							depletedBags={depletedBags}
							totalBags={diceBags.length}
							onDiceLeftClick={handleDiceLeftClick}
							onDiceRightClick={handleDiceRightClick}
							onBuyClick={handleBuyClick}
						/>
						<WagerListSection
							title="Active"
							wagers={active ?? []}
							walletAddress={walletAddress}
							onWagerClick={handleWagerClick}
							onWagerRightClick={handleWagerRightClick}
						/>

						<WagerListSection
							title="Incoming"
							wagers={incoming ?? []}
							walletAddress={walletAddress}
							onWagerClick={handleWagerClick}
							onWagerRightClick={handleWagerRightClick}
						/>
						<WagerListSection
							title="Pending"
							wagers={outgoing ?? []}
							walletAddress={walletAddress}
							onWagerClick={handleWagerClick}
							onWagerRightClick={handleWagerRightClick}
						/>

						<WagerListSection
							title="Claim"
							wagers={claimable ?? []}
							walletAddress={walletAddress}
							onWagerClick={handleWagerClick}
							onWagerRightClick={handleWagerRightClick}
						/>

						<HistorySection
							recentHistory={recentHistory}
							totalHistoryCount={totalHistoryCount}
							walletAddress={walletAddress}
							collapsed={collapsedSections.history}
							onToggle={() => toggleSection("history")}
							onItemClick={handleHistoryItemClick}
							onViewAll={handleViewAllHistory}
							resolveUsername={getUsernameBySvmAddress}
						/>
					</Stack>
				)}
			</Stack>
		</Panel>
	);
};
