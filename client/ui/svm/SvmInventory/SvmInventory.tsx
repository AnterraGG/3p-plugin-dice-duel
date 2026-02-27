/**
 * SvmInventory — SVM-specific inventory panel for Dice Duel.
 *
 * Matches the EVM EvmInventory layout and interactions:
 * - Left-click a dice bag → enter selection mode → click a player to challenge
 * - Right-click a dice bag → context menu with "Select Player to Wager"
 * - Wager slots with click/right-click actions
 */

import {
	usePluginIdentity,
	usePluginSvmTransaction,
} from "@townexchange/3p-plugin-sdk/client";
import {
	Button,
	Panel,
	Stack,
	StatusBox,
	Typography,
	useContextMenu,
	useSelectionStore,
} from "@townexchange/tex-ui-kit";
import { windowManagerApi } from "@townexchange/tex-ui-kit/api";
import type React from "react";
import { useState } from "react";
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
	DD_WAGER_DETAILS,
	DD_WAGER_HISTORY,
} from "../../../window-keys";
import { InventorySection } from "./InventorySection";
import { SvmDiceBagSlot } from "./SvmDiceBagSlot";
import { SvmHistoryItem } from "./SvmHistoryItem";
import styles from "./SvmInventory.module.scss";
import { SvmWagerSlot } from "./SvmWagerSlot";

interface SvmInventoryProps {
	className?: string;
}

export const SvmInventory: React.FC<SvmInventoryProps> = ({ className }) => {
	const { walletAddress } = usePluginSvmTransaction();
	const { open: openContextMenu } = useContextMenu();
	const startSelection = useSelectionStore((s) => s.startSelection);
	const { getUsernameBySvmAddress } = usePluginIdentity();

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
		resolved,
		recentHistory,
		totalHistoryCount,
		isLoading: wagersLoading,
	} = useSvmInventoryWagers();

	const { data: statsData } = useSvmPlayerStats();
	const { cancelWager } = useDiceDuelSvm();

	// Detect stuck pendingNonce: on-chain says there's a pending wager but indexer has none.
	// This happens when the indexer missed the wager creation event.
	const pendingNonce =
		statsData?.stats?.pendingNonce != null
			? BigInt(statsData.stats.pendingNonce)
			: null;
	const hasStuckPendingWager =
		pendingNonce !== null && outgoing.length === 0 && !wagersLoading;

	const handleCancelStuckWager = async () => {
		if (pendingNonce === null) return;
		try {
			await cancelWager.execute({ nonce: pendingNonce });
		} catch (e) {
			console.error("[SvmInventory] Failed to cancel stuck wager:", e);
		}
	};

	const { data: diceBagsData, isLoading: diceBagsLoading } = useSvmDiceBags();

	const diceBags = diceBagsData?.diceBags ?? [];
	const activeBags = diceBags.filter((b) => b.usesRemaining > 0);
	const depletedBags = diceBags.filter((b) => b.usesRemaining <= 0);
	const totalBags = diceBags.length;

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

	const toggleSection = (section: string) => {
		setCollapsedSections((prev) => ({
			...prev,
			[section]: !prev[section],
		}));
	};

	const startDiceSelection = (bag: SvmDiceBag) => {
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
				windowManagerApi.open(DD_INITIATE_WAGER as any, {
					opponentAddress: target.data?.svmAddress as string | undefined,
					opponentName: target.data?.displayName as string | undefined,
					diceBagMint: bag.mint,
				});
			},
		});
	};

	const handleDiceLeftClick = (bag: SvmDiceBag) => {
		if (bag.usesRemaining <= 0) return;
		startDiceSelection(bag);
	};

	const handleDiceRightClick =
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
					{
						id: "view-details",
						label: "View Details",
						onClick: () => {
							console.log("View dice bag details:", bag.mint);
						},
					},
				],
			});
		};

	const handleWagerClick = (wager: SvmWager) => {
		const isChallenger =
			wager.challenger.toLowerCase() === walletAddress.toLowerCase();

		if (wager.status === "Pending" && !isChallenger) {
			windowManagerApi.open(DD_INCOMING_WAGER as any, { wager });
		} else {
			windowManagerApi.open(DD_WAGER_DETAILS as any, { wager });
		}
	};

	const handleHistoryItemClick = (wager: SvmWager | SvmWagerCompact) => {
		windowManagerApi.open(DD_WAGER_DETAILS as any, { wager });
	};

	const handleWagerRightClick =
		(wager: SvmWager) => (event: React.MouseEvent) => {
			event.preventDefault();
			const addrShort = `${wager.address.slice(0, 4)}...${wager.address.slice(-4)}`;
			const isChallenger =
				wager.challenger.toLowerCase() === walletAddress.toLowerCase();
			const menuItems = [
				{
					id: "view-details",
					label: "View Details",
					onClick: () =>
						windowManagerApi.open(DD_WAGER_DETAILS as any, { wager }),
				},
			];

			if (wager.status === "Pending" && !isChallenger) {
				menuItems.unshift({
					id: "accept",
					label: "Accept Wager",
					onClick: () =>
						windowManagerApi.open(DD_INCOMING_WAGER as any, { wager }),
				});
			}

			openContextMenu({
				x: event.clientX,
				y: event.clientY,
				title: `Wager ${addrShort}`,
				items: menuItems,
			});
		};

	const isLoading = wagersLoading || diceBagsLoading;
	const incomingCount = incoming?.length ?? 0;
	const outgoingCount = outgoing?.length ?? 0;
	const activeCount = active?.length ?? 0;
	const claimableCount = claimable?.length ?? 0;

	return (
		<Panel
			padding="compact"
			className={className}
			style={{ width: 220, background: "#3a3028" }}
		>
			<Stack gap={2}>
				<Typography variant="gold" size="sm">
					Dice Duel
				</Typography>

					{/* Stuck pending wager warning — indexer missed creation, on-chain state is ahead */}
				{hasStuckPendingWager && (
					<StatusBox variant="error">
						<Stack gap={2}>
							<Typography variant="error" size="xs">
								Pending wager #{pendingNonce!.toString()} not found. Cancel it to
								create new wagers.
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
						{/* Your Dice */}
						<InventorySection title="Your Dice" count={totalBags} layout="grid">
							{activeBags.length > 0 || depletedBags.length > 0 ? (
								<>
									{activeBags.map((bag) => (
										<SvmDiceBagSlot
											key={bag.mint}
											diceBag={bag}
											onLeftClick={handleDiceLeftClick}
											onRightClick={handleDiceRightClick(bag)}
										/>
									))}
									{depletedBags.map((bag) => (
										<SvmDiceBagSlot
											key={bag.mint}
											diceBag={bag}
											onLeftClick={handleDiceLeftClick}
											onRightClick={handleDiceRightClick(bag)}
										/>
									))}
								</>
							) : (
								<Typography
									variant="muted"
									size="xs"
									style={{ padding: 8, textAlign: "center" }}
								>
									No dice. Visit the shop!
								</Typography>
							)}
						</InventorySection>

						{/* Incoming Wagers */}
						{incomingCount > 0 && (
							<InventorySection
								title="Incoming"
								count={incomingCount}
								layout="stack"
							>
								{incoming!.map((wager) => (
									<SvmWagerSlot
										key={wager.address}
										wager={wager}
										walletAddress={walletAddress}
										onClick={handleWagerClick}
										onRightClick={handleWagerRightClick(wager)}
									/>
								))}
							</InventorySection>
						)}

						{/* Claimable Wagers (winner can claim_winnings) */}
						{claimableCount > 0 && (
							<InventorySection
								title="Claim"
								count={claimableCount}
								layout="stack"
							>
								{claimable!.map((wager) => (
									<SvmWagerSlot
										key={wager.address}
										wager={wager}
										walletAddress={walletAddress}
										onClick={handleWagerClick}
										onRightClick={handleWagerRightClick(wager)}
									/>
								))}
							</InventorySection>
						)}

						{/* Outgoing Wagers */}
						{outgoingCount > 0 && (
							<InventorySection
								title="Pending"
								count={outgoingCount}
								layout="stack"
							>
								{outgoing!.map((wager) => (
									<SvmWagerSlot
										key={wager.address}
										wager={wager}
										walletAddress={walletAddress}
										onClick={handleWagerClick}
										onRightClick={handleWagerRightClick(wager)}
									/>
								))}
							</InventorySection>
						)}

						{/* Active Games */}
						{activeCount > 0 && (
							<InventorySection
								title="Active"
								count={activeCount}
								layout="stack"
							>
								{active!.map((wager) => (
									<SvmWagerSlot
										key={wager.address}
										wager={wager}
										walletAddress={walletAddress}
										onClick={handleWagerClick}
										onRightClick={handleWagerRightClick(wager)}
									/>
								))}
							</InventorySection>
						)}

						{/* History (collapsible, compact) */}
						{recentHistory.length > 0 && (
							<InventorySection
								title="History"
								count={totalHistoryCount}
								collapsed={collapsedSections.history}
								onToggle={() => toggleSection("history")}
								layout="stack"
							>
								{recentHistory.map((wager) => (
									<SvmHistoryItem
										key={wager.address}
										wager={wager}
										walletAddress={walletAddress}
										onClick={handleHistoryItemClick}
										resolveUsername={getUsernameBySvmAddress}
									/>
								))}
								{totalHistoryCount > recentHistory.length && (
									<button
										type="button"
										className={styles.viewAllLink}
										onClick={() =>
											windowManagerApi.open(DD_WAGER_HISTORY as any, {} as any)
										}
									>
										View all {totalHistoryCount} duels →
									</button>
								)}
							</InventorySection>
						)}
					</Stack>
				)}
			</Stack>
		</Panel>
	);
};
