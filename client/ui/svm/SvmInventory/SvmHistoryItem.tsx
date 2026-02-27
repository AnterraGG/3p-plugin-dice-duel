/**
 * SvmHistoryItem — Compact history row for settled SVM wagers.
 * Matches the visual design/structure of EVM HistoryItemCompact.
 */

import { TokenIcon } from "@townexchange/token-icons";
import type React from "react";
import type { SvmWager, SvmWagerCompact } from "../../../api";
import styles from "./SvmInventory.module.scss";

interface SvmHistoryItemProps {
	wager: SvmWager | SvmWagerCompact;
	walletAddress: string;
	onClick?: (wager: SvmWager | SvmWagerCompact) => void;
	resolveUsername?: (address: string) => string;
}

const MAX_NAME_LENGTH = 12;

export const SvmHistoryItem: React.FC<SvmHistoryItemProps> = ({
	wager,
	walletAddress,
	onClick,
	resolveUsername,
}) => {
	const handleClick = () => onClick?.(wager);
	const sol = Number(wager.amount) / 1e9;
	const displayAmount = sol < 0.001 ? "<.001" : sol.toFixed(3);
	const isWin = wager.winner?.toLowerCase() === walletAddress.toLowerCase();
	const isChallenger =
		wager.challenger.toLowerCase() === walletAddress.toLowerCase();
	const opponentAddress = isChallenger ? wager.opponent : wager.challenger;
	const opponentName = resolveUsername
		? resolveUsername(opponentAddress)
		: undefined;
	let opponentDisplay: string;
	if (!opponentName || opponentName.length > 40) {
		opponentDisplay = opponentAddress
			? `${opponentAddress.slice(0, 4)}...${opponentAddress.slice(-4)}`
			: `#${wager.address}`;
	} else if (opponentName.length > MAX_NAME_LENGTH) {
		opponentDisplay = `${opponentName.slice(0, MAX_NAME_LENGTH)}...`;
	} else {
		opponentDisplay = opponentName;
	}
	return (
		<div
			className={styles.historyItemCompact}
			onClick={handleClick}
			style={{ borderLeftColor: isWin ? "#22c55e" : "#ef4444" }}
		>
			<span className={styles.historyOpponent}>{opponentDisplay}</span>
			<span className={styles.historyAmount}>
				<TokenIcon ticker="SOL" size={14} />
				{displayAmount}
			</span>
		</div>
	);
};
