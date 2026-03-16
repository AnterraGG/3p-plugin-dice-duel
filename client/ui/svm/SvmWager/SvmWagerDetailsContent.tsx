/**
 * SvmWagerDetailsContent — SVM wager details window.
 *
 * Compact header, matchup grid, timestamps, close button.
 */

import type { Address } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import {
	usePluginIdentity,
	usePluginSvmTransaction,
} from "@townexchange/3p-plugin-sdk/client";
import {
	Button,
	GameWindow,
	Stack,
	StatusBox,
	Typography,
	modalStyles,
	notificationApi,
} from "@townexchange/tex-ui-kit";
import type React from "react";
import { useCallback, useState } from "react";

import type { SvmWager } from "../../../api";
import inventoryStyles from "../SvmInventory/SvmInventory.module.scss";
import { logDiceDuelError } from "../../../hooks/svm/errors";
import {
	queryKeys,
	useSvmGameConfig,
} from "../../../hooks/svm/queries-indexed";
import { useDiceDuelSvm } from "../../../hooks/svm/useDiceDuelSvm";
import { getVrfTimeoutState } from "../../../hooks/vrfTimeout";

interface Props {
	wager: SvmWager;
	onClose: () => void;
}

export default function SvmWagerDetailsContent(props: Props) {
	return (
		<GameWindow
			id="dice-duel:wager-details"
			title="Dice Duel — Details"
			size="md"
			isOpen
			onClose={props.onClose}
			overlay={false}
			modal={false}
			draggable
			escapable
			position={{ x: "3%", y: "15%" }}
		>
			<SvmWagerDetailsInner {...props} />
		</GameWindow>
	);
}

const truncAddr = (a: string) =>
	a ? `${a.slice(0, 4)}...${a.slice(-4)}` : "???";

const lamportsToSol = (l: string) => {
	const sol = Number(l) / 1e9;
	return sol < 0.001 ? "<0.001" : sol.toFixed(3);
};

const formatTimestamp = (timestamp: string | number): string => {
	const date = new Date(Number(timestamp) * 1000);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
};

const getStatusClass = (status: string): string => {
	switch (status) {
		case "Pending":
		case "VrfTimeout":
			return inventoryStyles.statusColorPending;
		case "Active":
			return inventoryStyles.statusColorActive;
		case "Resolved":
			return inventoryStyles.statusColorResolved;
		case "Settled":
			return inventoryStyles.statusColorSettled;
		case "Expired":
		case "Cancelled":
			return inventoryStyles.statusColorExpired;
		default:
			return inventoryStyles.statusColorDefault;
	}
};

const SvmWagerDetailsInner: React.FC<Props> = ({ wager, onClose }) => {
	const { walletAddress } = usePluginSvmTransaction();
	const { getUsernameBySvmAddress } = usePluginIdentity();
	const { claimWinnings, claimVrfTimeout, isLoading: isTxLoading } =
		useDiceDuelSvm();
	const { data: configData } = useSvmGameConfig();
	const queryClient = useQueryClient();
	const [isClaiming, setIsClaiming] = useState(false);

	const isChallenger = walletAddress === wager.challenger;
	const isOpponent = walletAddress === wager.opponent;
	const isParticipant = isChallenger || isOpponent;
	const isWinner = wager.winner !== null && walletAddress === wager.winner;
	const isLoser = isParticipant && !isWinner && wager.winner !== null;
	const totalPrize = (Number(wager.amount) * 2) / 1e9;
	const isResolved = wager.status === "Resolved";
	const canClaim = isResolved && isWinner;

	const hasResults = wager.vrfResult !== null && wager.winner !== null;

	// VRF timeout — only trust on-chain status, no client-side countdown
	const { isVrfTimeout, isActive } = getVrfTimeoutState(wager);

	// No inline notification on success — the server-driven wager_claimed event
	// in DiceDuelUIContainer handles the "Winnings Claimed" toast with the
	// actual payout amount from the chain.
	const handleClaimWinnings = useCallback(async () => {
		if (!configData?.config?.treasury) return;
		setIsClaiming(true);
		try {
			await claimWinnings.execute({
				challenger: wager.challenger as Address,
				treasury: configData.config.treasury as Address,
				nonce: BigInt(wager.nonce),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.inventoryWagers.all(),
			});
			queryClient.invalidateQueries({ queryKey: queryKeys.wagerHistory.all() });
		} catch (e: any) {
			const decoded = logDiceDuelError("claimWinnings", e);
			notificationApi.notify({
				type: "error",
				title: "Claim Failed",
				message: decoded.message,
				channel: "dice-duel",
			});
		}
		setIsClaiming(false);
	}, [claimWinnings, wager.challenger, configData, queryClient]);

	const handleClaimVrfTimeout = useCallback(async () => {
		setIsClaiming(true);
		try {
			await claimVrfTimeout.execute({
				challenger: wager.challenger as Address,
				opponent: wager.opponent as Address,
				nonce: BigInt(wager.nonce),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.inventoryWagers.all(),
			});
			queryClient.invalidateQueries({ queryKey: queryKeys.wagerHistory.all() });
		} catch (e: any) {
			const decoded = logDiceDuelError("claimVrfTimeout", e);
			notificationApi.notify({
				type: "error",
				title: "VRF Timeout Failed",
				message: decoded.message,
				channel: "dice-duel",
			});
		}
		setIsClaiming(false);
	}, [
		claimVrfTimeout,
		wager.challenger,
		wager.opponent,
		wager.nonce,
		queryClient,
	]);

	const challengerChoice = wager.challengerChoice === 0 ? "Low" : "High";
	const opponentChoice = challengerChoice === "High" ? "Low" : "High";

	const addrShort = truncAddr(wager.address);

	const getTimestampInfo = (): { label: string; value: string } | null => {
		if (wager.settledAt)
			return { label: "Settled", value: formatTimestamp(wager.settledAt) };
		if (wager.createdAt)
			return { label: "Created", value: formatTimestamp(wager.createdAt) };
		return null;
	};

	return (
		<Stack gap={4} style={{ padding: "1rem", minWidth: 300 }}>
			{/* Compact Header: Wager address + Status */}
			<div className={modalStyles.infoBox}>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						Wager {addrShort}
					</Typography>
					<Typography
						variant="light"
						size="sm"
						className={getStatusClass(wager.status)}
					>
						{wager.status === "Resolved" ? "Winner Determined" : wager.status}
					</Typography>
				</div>
			</div>

			{/* Result Display */}
			{hasResults && isParticipant && (
				<div
					className={`${inventoryStyles.resultDisplay} ${isWinner ? inventoryStyles.resultWin : inventoryStyles.resultLose}`}
				>
					<Typography variant={isWinner ? "success" : "error"} size="lg" bold>
						{canClaim
							? "Winner! Claim your winnings"
							: isWinner
								? "You Won!"
								: "You Lost"}
					</Typography>
					{isWinner && (
						<Typography variant="gold" size="sm">
							{canClaim
								? `${totalPrize.toFixed(3)} SOL waiting`
								: `+${totalPrize.toFixed(3)} SOL`}
						</Typography>
					)}
					{wager.vrfResult !== null && (
						<Typography variant="muted" size="xs">
							VRF Result: {wager.vrfResult}
						</Typography>
					)}
				</div>
			)}

			{/* Matchup + Amounts */}
			<div className={modalStyles.infoBox}>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr auto 1fr",
						gap: "2px 12px",
						padding: "4px 8px",
					}}
				>
					{/* vs — spans all rows, dead center */}
					<div
						style={{
							gridColumn: 2,
							gridRow: "1 / 5",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Typography
							variant="muted"
							size="sm"
							style={{ opacity: 0.8, fontStyle: "italic" }}
						>
							vs
						</Typography>
					</div>

					{/* Row 1: Names — bold = you */}
					<Typography
						variant="light"
						size="sm"
						bold={isChallenger}
						style={{ gridColumn: 1, gridRow: 1, textAlign: "center" }}
					>
						{getUsernameBySvmAddress(wager.challenger)}
					</Typography>
					<Typography
						variant="light"
						size="sm"
						bold={isOpponent}
						style={{ gridColumn: 3, gridRow: 1, textAlign: "center" }}
					>
						{getUsernameBySvmAddress(wager.opponent)}
					</Typography>

					{/* Row 2: Amounts */}
					<Typography
						variant="light"
						size="sm"
						style={{ gridColumn: 1, gridRow: 2, textAlign: "center" }}
					>
						{lamportsToSol(wager.amount)} SOL
					</Typography>
					<Typography
						variant="light"
						size="sm"
						style={{ gridColumn: 3, gridRow: 2, textAlign: "center" }}
					>
						{lamportsToSol(wager.amount)} SOL
					</Typography>

					{/* Row 3: Role label */}
					<Typography
						variant="muted"
						size="xs"
						style={{ gridColumn: 1, gridRow: 3, textAlign: "center" }}
					>
						Challenger
					</Typography>
					<Typography
						variant="muted"
						size="xs"
						style={{ gridColumn: 3, gridRow: 3, textAlign: "center" }}
					>
						Opponent
					</Typography>

					{/* Row 4: Position label */}
					<Typography
						variant="muted"
						size="xs"
						style={{
							gridColumn: 1,
							gridRow: 4,
							textAlign: "center",
							opacity: 0.7,
						}}
					>
						{challengerChoice}
					</Typography>
					<Typography
						variant="muted"
						size="xs"
						style={{
							gridColumn: 3,
							gridRow: 4,
							textAlign: "center",
							opacity: 0.7,
						}}
					>
						{opponentChoice}
					</Typography>
				</div>

				{/* Total wagered — centered, stacked */}
				{(wager.status === "Settled" ||
					wager.status === "Resolved" ||
					hasResults) && (
					<div className={inventoryStyles.totalWageredDivider}>
						<div>
							<Typography variant="gold" size="sm">
								{totalPrize.toFixed(3)} SOL
							</Typography>
						</div>
						<div>
							<Typography variant="muted" size="xs">
								Total Wagered
							</Typography>
						</div>
					</div>
				)}
			</div>

			{/* VRF Result (non-participant view) */}
			{wager.vrfResult !== null && !isParticipant && (
				<div className={modalStyles.infoBox}>
					<div className={modalStyles.infoRow}>
						<Typography variant="muted" size="xs">
							VRF Result
						</Typography>
						<Typography variant="light" size="sm">
							{wager.vrfResult}
						</Typography>
					</div>
					{wager.winner && (
						<div className={modalStyles.infoRow}>
							<Typography variant="muted" size="xs">
								Winner
							</Typography>
							<Typography variant="light" size="sm">
								{getUsernameBySvmAddress(wager.winner)}
							</Typography>
						</div>
					)}
				</div>
			)}

			{/* VRF Status — Active (awaiting VRF) */}
			{isActive && isParticipant && (
				<StatusBox variant="info">
					<Stack gap={2}>
						<Typography variant="light" size="sm">
							Awaiting VRF result...
						</Typography>
					</Stack>
				</StatusBox>
			)}

			{/* VRF Timed Out status */}
			{isVrfTimeout && isParticipant && (
				<StatusBox variant="error">
					<Stack gap={2}>
						<Typography variant="error" size="sm" bold>
							VRF timed out — Funds returned
						</Typography>
						<Typography variant="muted" size="xs">
							The random result did not arrive. Claim your refund below.
						</Typography>
					</Stack>
				</StatusBox>
			)}

			{/* Single timestamp line */}
			{getTimestampInfo() && (
				<div style={{ textAlign: "center" }}>
					<Typography variant="muted" size="xs">
						{getTimestampInfo()!.label} {getTimestampInfo()!.value}
					</Typography>
				</div>
			)}

			{/* Action Buttons */}
			<div className={modalStyles.footer}>
				{canClaim && (
					<Button
						variant="primary"
						width="full"
						onClick={handleClaimWinnings}
						disabled={isClaiming || isTxLoading}
					>
						{isClaiming ? "Claiming..." : `Claim ${totalPrize.toFixed(3)} SOL`}
					</Button>
				)}
				{isVrfTimeout && isParticipant && (
					<Button
						variant="primary"
						width="full"
						onClick={handleClaimVrfTimeout}
						disabled={isClaiming || isTxLoading}
					>
						{isClaiming
							? "Claiming Refund..."
							: `Claim VRF Timeout Refund (${lamportsToSol(wager.amount)} SOL)`}
					</Button>
				)}
				<Button variant="secondary" width="full" onClick={onClose}>
					Close
				</Button>
			</div>
		</Stack>
	);
};
