/**
 * SvmWagerSlot — Displays a single SVM wager in the inventory panel.
 *
 * Matches EVM WagerItemSlot visual structure: two-line card with opponent + amount,
 * meta text + status badge. Uses extracted StatusBadge component.
 * Wired with SVM action handlers for cancel, claim expired, and claim VRF timeout.
 */

import type { Address } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import { usePluginIdentity } from "@townexchange/3p-plugin-sdk/client";
import { Card, Flex, notificationApi } from "@townexchange/tex-ui-kit";
import { TokenIcon } from "@townexchange/token-icons";
import type React from "react";
import { useCallback, useState } from "react";
import type { MouseEventHandler } from "react";
import type { SvmWager, SvmWagerStatus } from "../../../api";
import { logDiceDuelError } from "../../../hooks/svm/errors";
import {
	queryKeys,
	useSvmGameConfig,
} from "../../../hooks/svm/queries-indexed";
import { useDiceDuelSvm } from "../../../hooks/svm/useDiceDuelSvm";
import { useCountdown } from "../../../hooks/useCountdown";
import {
	playClickSound,
	playCoinSound,
	playErrorSound,
} from "../../../services/DiceDuelAudioService";
import styles from "./SvmInventory.module.scss";

interface SvmWagerSlotProps {
	wager: SvmWager;
	walletAddress: string;
	onClick?: (wager: SvmWager) => void;
	onRightClick?: MouseEventHandler<HTMLDivElement>;
}

/** Convert lamports string to SOL display */
const lamportsToSol = (lamports: string): string => {
	const sol = Number(lamports) / 1e9;
	if (sol < 0.001) return "<0.001";
	return sol.toFixed(3);
};

/** Truncate a base58 address */
const truncateAddress = (addr: string): string =>
	addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "???";

// Status badge types — superset of EVM types plus SVM-specific ones
type StatusType =
	| "pending"
	| "accept"
	| "active"
	| "rolling"
	| "claimable"
	| "won"
	| "lost"
	| "settled"
	| "expired"
	| "vrfTimeout";

const getStatusInfo = (
	wager: SvmWager,
	walletAddress: string,
): { type: StatusType; label: string } | null => {
	const isChallenger =
		wager.challenger.toLowerCase() === walletAddress.toLowerCase();

	switch (wager.status) {
		case "Pending":
			return isChallenger
				? { type: "pending", label: "PENDING" }
				: { type: "accept", label: "ACCEPT" };
		case "Active":
			return { type: "active", label: "ACTIVE" };
		case "Resolved": {
			if (wager.winner) {
				const won = wager.winner.toLowerCase() === walletAddress.toLowerCase();
				if (won) {
					return { type: "claimable", label: "CLAIM" };
				}
				return { type: "lost", label: "LOST" };
			}
			return { type: "settled", label: "RESOLVED" };
		}
		case "Settled": {
			if (wager.winner) {
				const won = wager.winner.toLowerCase() === walletAddress.toLowerCase();
				if (won) {
					return { type: "won", label: "WON" };
				}
				return { type: "lost", label: "LOST" };
			}
			return { type: "settled", label: "SETTLED" };
		}
		case "Cancelled":
			return { type: "expired", label: "CANCELLED" };
		case "Expired":
			return { type: "expired", label: "EXPIRED" };
		case "VrfTimeout":
			return { type: "vrfTimeout", label: "VRF TIMEOUT" };
		default:
			return { type: "pending", label: wager.status };
	}
};

const getCardClass = (status: SvmWagerStatus): string => {
	const map: Record<SvmWagerStatus, string | undefined> = {
		Pending: styles.wagerCardIncoming,
		Active: styles.wagerCardActive,
		ReadyToSettle: styles.wagerCardActive,
		Settled: styles.wagerCardSettled,
		Cancelled: styles.wagerCardExpired,
		Expired: styles.wagerCardExpired,
		VrfTimeout: styles.wagerCardVrfTimeout,
		Resolved: styles.wagerCardSettled,
	};
	return map[status] ?? "";
};

// Status badge component (extracted, matching EVM pattern)
const StatusBadge: React.FC<{ type: StatusType; label: string }> = ({
	type,
	label,
}) => {
	const typeToClass: Record<StatusType, string> = {
		pending: styles.statusPending,
		accept: styles.statusAccept,
		active: styles.statusActive,
		rolling: styles.statusRolling,
		claimable: styles.statusClaimable,
		won: styles.statusWon,
		lost: styles.statusLost,
		settled: styles.statusSettled,
		expired: styles.statusExpired,
		vrfTimeout: styles.statusVrfTimeout,
	};

	return (
		<span className={`${styles.statusBadge} ${typeToClass[type]}`}>
			{label}
		</span>
	);
};

export const SvmWagerSlot: React.FC<SvmWagerSlotProps> = ({
	wager,
	walletAddress,
	onClick,
	onRightClick,
}) => {
	const queryClient = useQueryClient();
	const { getUsernameBySvmAddress } = usePluginIdentity();
	const {
		cancelWager,
		claimExpired,
		claimVrfTimeout,
		claimWinnings,
		isLoading,
	} = useDiceDuelSvm();
	const { data: configData } = useSvmGameConfig();
	const [actionState, setActionState] = useState<
		"idle" | "confirming" | "confirm-cancel"
	>("idle");

	const statusInfo = getStatusInfo(wager, walletAddress);
	const isChallenger =
		wager.challenger.toLowerCase() === walletAddress.toLowerCase();
	const opponentAddr = isChallenger ? wager.opponent : wager.challenger;
	const opponentDisplay = getUsernameBySvmAddress(opponentAddr);
	const expiresAtNum = wager.expiresAt ? Number(wager.expiresAt) : null;
	const countdown = useCountdown(
		wager.status === "Pending" ? expiresAtNum : null,
	);

	const invalidateQueries = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.inventoryWagers.all(),
		});
		queryClient.invalidateQueries({ queryKey: queryKeys.diceBags.all() });
	}, [queryClient]);

	const handleCancel = useCallback(async () => {
		if (actionState !== "confirm-cancel") {
			setActionState("confirm-cancel");
			playClickSound();
			return;
		}
		setActionState("confirming");
		try {
			await cancelWager.execute({ nonce: BigInt(wager.nonce) });
			// No inline notification — server-driven wager_cancelled event
			// in DiceDuelUIContainer handles the toast + sound.
			invalidateQueries();
		} catch (e: any) {
			const decoded = logDiceDuelError("cancelWager", e);
			playErrorSound();
			notificationApi.notify({
				type: "error",
				title: "Error",
				message: `Cancel failed: ${decoded.message}`,
				channel: "dice-duel",
			});
		}
		setActionState("idle");
	}, [actionState, cancelWager, invalidateQueries, wager.nonce]);

	const handleClaimExpired = useCallback(async () => {
		setActionState("confirming");
		playClickSound();
		try {
			await claimExpired.execute({
				challenger: wager.challenger as Address,
				nonce: BigInt(wager.nonce),
			});
			// No inline notification — server-driven wager_expired event
			// in DiceDuelUIContainer handles the toast.
			invalidateQueries();
		} catch (e: any) {
			const decoded = logDiceDuelError("claimExpired", e);
			playErrorSound();
			notificationApi.notify({
				type: "error",
				title: "Error",
				message: `Claim failed: ${decoded.message}`,
				channel: "dice-duel",
			});
		}
		setActionState("idle");
	}, [claimExpired, wager.challenger, invalidateQueries]);

	const handleClaimWinnings = useCallback(async () => {
		if (!configData?.config?.treasury) {
			notificationApi.notify({
				type: "error",
				title: "Error",
				message: "Game config not loaded yet. Try again.",
				channel: "dice-duel",
			});
			return;
		}
		setActionState("confirming");
		playClickSound();
		try {
			await claimWinnings.execute({
				challenger: wager.challenger as Address,
				treasury: configData.config.treasury as Address,
				nonce: BigInt(wager.nonce),
			});
			playCoinSound();
			// No inline notification — the server-driven wager_claimed event
			// in DiceDuelUIContainer handles the "Winnings Claimed" toast
			// with the actual payout amount from the chain.
			invalidateQueries();
		} catch (e: any) {
			const decoded = logDiceDuelError("claimWinnings", e);
			playErrorSound();
			notificationApi.notify({
				type: "error",
				title: "Error",
				message: `Claim failed: ${decoded.message}`,
				channel: "dice-duel",
			});
		}
		setActionState("idle");
	}, [
		claimWinnings,
		wager.challenger,
		wager.amount,
		configData,
		invalidateQueries,
	]);

	const handleClaimVrfTimeout = useCallback(async () => {
		setActionState("confirming");
		playClickSound();
		try {
			await claimVrfTimeout.execute({
				challenger: wager.challenger as Address,
				opponent: wager.opponent as Address,
				nonce: BigInt(wager.nonce),
			});
			// No inline notification — server-driven wager_vrf_timeout event
			// in DiceDuelUIContainer handles the toast.
			invalidateQueries();
		} catch (e: any) {
			const decoded = logDiceDuelError("claimVrfTimeout", e);
			playErrorSound();
			notificationApi.notify({
				type: "error",
				title: "Error",
				message: `Claim failed: ${decoded.message}`,
				channel: "dice-duel",
			});
		}
		setActionState("idle");
	}, [claimVrfTimeout, wager.challenger, wager.opponent, invalidateQueries]);

	const handleClick = useCallback(() => {
		// Cancel own pending wager
		if (statusInfo?.type === "pending" && isChallenger) {
			handleCancel();
			return;
		}

		// Claim winnings (Resolved status, user is winner)
		if (wager.status === "Resolved" && statusInfo?.type === "claimable") {
			handleClaimWinnings();
			return;
		}

		// Claim expired
		if (wager.status === "Expired") {
			handleClaimExpired();
			return;
		}

		// Claim VRF timeout
		if (wager.status === "VrfTimeout") {
			handleClaimVrfTimeout();
			return;
		}

		// Fallback to generic onClick (parent handles accept/details routing)
		onClick?.(wager);
	}, [
		statusInfo,
		isChallenger,
		wager,
		onClick,
		handleCancel,
		handleClaimWinnings,
		handleClaimExpired,
		handleClaimVrfTimeout,
	]);

	const busy = isLoading || actionState === "confirming";

	const cardClasses = [styles.wagerCard, getCardClass(wager.status)].filter(
		Boolean,
	);
	if (statusInfo?.type === "claimable") {
		const idx = cardClasses.indexOf(styles.wagerCardSettled);
		if (idx >= 0) cardClasses.splice(idx, 1);
		cardClasses.push(styles.wagerCardClaimable);
	}

	return (
		<Card
			variant="inset"
			size="sm"
			interactive
			onClick={busy ? undefined : handleClick}
			onContextMenu={onRightClick}
			title={`Wager ${truncateAddress(wager.address)}`}
			className={cardClasses.join(" ")}
			style={{
				padding: "4px 8px",
				opacity: busy ? 0.6 : 1,
				cursor: busy ? "var(--cursor-wait, wait)" : "var(--cursor-pointer, pointer)",
			}}
		>
			{/* Line 1: Opponent name + Amount */}
			<Flex align="center" justify="between" gap={4}>
				<span className={styles.wagerOpponent}>{opponentDisplay}</span>
				<span className={styles.wagerAmount}>
					<TokenIcon ticker="SOL" size={14} />
					<span>{lamportsToSol(wager.amount)}</span>
				</span>
			</Flex>

			{/* Line 2: Meta text + Status badge */}
			<Flex align="center" justify="between" gap={4} style={{ marginTop: 1 }}>
				<span className={styles.wagerMeta}>
					{statusInfo?.type === "claimable"
						? "You won"
						: isChallenger
							? "You challenged"
							: "Challenged you"}
					{countdown && (
						<span
							style={{
								marginLeft: 4,
								color:
									Number(wager.expiresAt) - Math.floor(Date.now() / 1000) < 60
										? "#ef4444"
										: "#f59e0b",
								fontSize: 9,
								fontWeight: 600,
								fontVariantNumeric: "tabular-nums",
							}}
						>
							⏱ {countdown}
						</span>
					)}
				</span>
				{actionState === "confirm-cancel" ? (
					<StatusBadge type="expired" label="CONFIRM?" />
				) : actionState === "confirming" ? (
					<StatusBadge type="pending" label="..." />
				) : statusInfo ? (
					<StatusBadge type={statusInfo.type} label={statusInfo.label} />
				) : null}
			</Flex>
		</Card>
	);
};
