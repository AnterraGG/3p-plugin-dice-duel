/**
 * SvmWagerHistoryContent — SVM wager history window.
 *
 * Uses cursor-paginated useSvmWagerHistory() with infinite query.
 * Stats summary (infoBox/infoRow), scrollable paginated history list,
 * "Load more" button, close button.
 */

import {
	usePluginIdentity,
	usePluginSvmTransaction,
	usePluginWindows,
} from "@anterra/3p-plugin-sdk/client";
import {
	Button,
	Flex,
	GameWindow,
	Stack,
	Typography,
	modalStyles,
} from "@anterra/tex-ui-kit";
import type React from "react";

import { TokenIcon } from "@anterra/token-icons";
import type { SvmWagerCompact } from "../../../api";
import {
	useSvmPlayerStats,
	useSvmWagerHistory,
} from "../../../hooks/svm/queries-indexed";
import { DD_WAGER_DETAILS } from "../../../window-keys";
import inventoryStyles from "../SvmInventory/SvmInventory.module.scss";

interface Props {
	onClose: () => void;
}

export default function SvmWagerHistoryContent({ onClose }: Props) {
	return (
		<GameWindow
			id="dice-duel:wager-history"
			title="Dice Duel — History"
			size="md"
			isOpen
			onClose={onClose}
			overlay={false}
			modal={false}
			draggable
			escapable
			position={{ x: "3%", y: "15%" }}
		>
			<SvmWagerHistoryInner onClose={onClose} />
		</GameWindow>
	);
}

const HistoryListItem: React.FC<{
	wager: SvmWagerCompact;
	walletAddress: string;
	resolveUsername: (address: string) => string;
	onClick: () => void;
}> = ({ wager, walletAddress, resolveUsername, onClick }) => {
	const sol = Number(wager.amount) / 1e9;
	const displayAmount = sol < 0.001 ? "<.001" : sol.toFixed(3);
	const isChallenger = wager.challenger === walletAddress;
	const opponentAddress = isChallenger ? wager.opponent : wager.challenger;
	const opponentDisplay = resolveUsername(opponentAddress);

	const isExpired = wager.status === "Expired" || wager.status === "Cancelled";
	const isWin = !isExpired && wager.winner === walletAddress;
	const isLoss =
		!isExpired && wager.winner !== null && wager.winner !== walletAddress;

	const borderClass = isWin
		? inventoryStyles.historyBorderWin
		: isLoss
			? inventoryStyles.historyBorderLoss
			: inventoryStyles.historyBorderExpired;
	const badgeClass = isWin
		? inventoryStyles.historyBadgeWin
		: isLoss
			? inventoryStyles.historyBadgeLoss
			: inventoryStyles.historyBadgeExpired;
	const badgeLabel = isWin ? "W" : isLoss ? "L" : "X";

	const timestamp = wager.settledAt || wager.createdAt;
	const dateStr = timestamp
		? new Date(Number(timestamp) * 1000).toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
			})
		: "";

	return (
		<div
			onClick={onClick}
			className={`${inventoryStyles.historyListItem} ${borderClass}`}
		>
			{/* Line 1: opponent + amount */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
				}}
			>
				<span
					className={inventoryStyles.historyTextCream}
					style={{
						fontSize: 11,
						fontWeight: 400,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						flex: 1,
						minWidth: 0,
					}}
				>
					{opponentDisplay}
				</span>
				<span
					className={inventoryStyles.historyTextCream}
					style={{
						fontSize: 11,
						fontWeight: 500,
						display: "inline-flex",
						alignItems: "center",
						gap: 3,
						flexShrink: 0,
					}}
				>
					<TokenIcon ticker="SOL" size={14} />

					{displayAmount}
				</span>
			</div>
			{/* Line 2: date + badge */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<span className={inventoryStyles.historyTextMuted} style={{ fontSize: 9 }}>{dateStr}</span>
				<span
					className={badgeClass}
					style={{
						fontSize: 9,
						fontWeight: 600,
						padding: "1px 5px",
						borderRadius: 2,
					}}
				>
					{badgeLabel}
				</span>
			</div>
		</div>
	);
};

const SvmWagerHistoryInner: React.FC<Props> = ({ onClose }) => {
	const { walletAddress } = usePluginSvmTransaction();
	const { getUsernameBySvmAddress } = usePluginIdentity();
	const pluginWindows = usePluginWindows();
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
		useSvmWagerHistory(20);
	const { data: statsData } = useSvmPlayerStats();

	const stats = statsData?.stats;

	const handleWagerClick = (wager: SvmWagerCompact) => {
		pluginWindows.open(DD_WAGER_DETAILS, { wager });
	};

	const allWagers = data?.pages.flatMap((p) => p.wagers) ?? [];
	const totalCount = data?.pages[0]?.totalCount ?? 0;

	const wins = stats?.wins ?? 0;
	const losses = stats?.losses ?? 0;
	const totalGames = stats?.totalGames ?? 0;
	const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

	return (
		<Stack gap={3} style={{ padding: "1rem", minWidth: 320 }}>
			{/* Stats Summary */}
			<div className={modalStyles.infoBox}>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						Games Played
					</Typography>
					<Typography size="sm">{totalGames}</Typography>
				</div>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						Record
					</Typography>
					<Flex gap={1}>
						<span className={inventoryStyles.recordWins}>{wins}W</span>
						<span className={inventoryStyles.recordSeparator}>-</span>
						<span className={inventoryStyles.recordLosses}>{losses}L</span>
					</Flex>
				</div>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						Win Rate
					</Typography>
					<Typography variant={winRate >= 50 ? "success" : "error"} size="sm">
						{winRate}%
					</Typography>
				</div>
				{totalCount > 0 && (
					<div className={modalStyles.infoRow}>
						<Typography variant="muted" size="xs">
							Total History
						</Typography>
						<Typography size="sm">{totalCount}</Typography>
					</div>
				)}
			</div>

			{/* Wager List */}
			{isLoading ? (
				<Typography
					variant="muted"
					size="sm"
					style={{ textAlign: "center", padding: 16 }}
				>
					Loading...
				</Typography>
			) : allWagers.length > 0 ? (
				<Stack
					gap={1}
					style={{
						maxHeight: 280,
						overflowY: "auto",
					}}
				>
					{allWagers.map((wager) => (
						<HistoryListItem
							key={wager.address}
							wager={wager}
							walletAddress={walletAddress ?? ""}
							resolveUsername={getUsernameBySvmAddress}
							onClick={() => handleWagerClick(wager)}
						/>
					))}
					{hasNextPage && (
						<Button
							variant="secondary"
							width="full"
							onClick={() => fetchNextPage()}
							disabled={isFetchingNextPage}
						>
							{isFetchingNextPage ? "Loading..." : "Load more"}
						</Button>
					)}
				</Stack>
			) : (
				<Typography
					variant="muted"
					size="sm"
					style={{ textAlign: "center", padding: 16 }}
				>
					No wager history yet
				</Typography>
			)}

			{/* Close Button */}
			<div className={modalStyles.footer}>
				<Button variant="secondary" width="full" onClick={onClose}>
					Close
				</Button>
			</div>
		</Stack>
	);
};
