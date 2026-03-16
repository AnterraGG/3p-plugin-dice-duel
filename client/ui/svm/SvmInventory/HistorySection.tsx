/**
 * HistorySection — Collapsible history list with "view all" link.
 */

import type React from "react";
import type { SvmWager, SvmWagerCompact } from "../../../api";
import { InventorySection } from "./InventorySection";
import { SvmHistoryItem } from "./SvmHistoryItem";
import styles from "./SvmInventory.module.scss";

interface HistorySectionProps {
	recentHistory: (SvmWager | SvmWagerCompact)[];
	totalHistoryCount: number;
	walletAddress: string;
	collapsed: boolean;
	onToggle: () => void;
	onItemClick: (wager: SvmWager | SvmWagerCompact) => void;
	onViewAll: () => void;
	resolveUsername: (address: string) => string;
}

export const HistorySection: React.FC<HistorySectionProps> = ({
	recentHistory,
	totalHistoryCount,
	walletAddress,
	collapsed,
	onToggle,
	onItemClick,
	onViewAll,
	resolveUsername,
}) => {
	if (recentHistory.length === 0) return null;

	return (
		<InventorySection
			title="History"
			count={totalHistoryCount}
			collapsed={collapsed}
			onToggle={onToggle}
			layout="stack"
		>
			{recentHistory.map((wager) => (
				<SvmHistoryItem
					key={wager.address}
					wager={wager}
					walletAddress={walletAddress}
					onClick={onItemClick}
					resolveUsername={resolveUsername}
				/>
			))}
			{totalHistoryCount > recentHistory.length && (
				<button
					type="button"
					className={styles.viewAllLink}
					onClick={onViewAll}
				>
					View all {totalHistoryCount} duels →
				</button>
			)}
		</InventorySection>
	);
};
