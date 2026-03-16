/**
 * BuyDiceBagSlot — Grid-sized "+" card that opens the dice shop.
 * Matches SvmDiceBagSlot dimensions so it fits naturally in the dice grid.
 */

import { Card, Typography } from "@townexchange/tex-ui-kit";
import type React from "react";
import styles from "./SvmInventory.module.scss";

interface BuyDiceBagSlotProps {
	onClick: () => void;
}

export const BuyDiceBagSlot: React.FC<BuyDiceBagSlotProps> = ({ onClick }) => {
	return (
		<Card
			variant="inset"
			size="sm"
			interactive
			onClick={onClick}
			title="Buy a new dice bag"
			className={styles.buySlot}
		>
			<span className={styles.buySlotIcon}>+</span>
			<Typography as="span" variant="muted" size="xs" className={styles.buySlotLabel}>
				Shop
			</Typography>
		</Card>
	);
};
