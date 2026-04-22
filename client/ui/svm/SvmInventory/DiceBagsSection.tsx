/**
 * DiceBagsSection — "Your Dice" grid with dice bag slots and buy CTA.
 * Pure presentation — all data and handlers passed via props.
 */

import { Stack, Typography } from "@anterra/tex-ui-kit";
import type React from "react";
import type { SvmDiceBag } from "../../../api";
import { BuyDiceBagSlot } from "./BuyDiceBagSlot";
import { InventorySection } from "./InventorySection";
import { SvmDiceBagSlot } from "./SvmDiceBagSlot";

interface DiceBagsSectionProps {
	activeBags: SvmDiceBag[];
	depletedBags: SvmDiceBag[];
	totalBags: number;
	onDiceLeftClick: (bag: SvmDiceBag) => void;
	onDiceRightClick: (bag: SvmDiceBag) => (event: React.MouseEvent) => void;
	onBuyClick: () => void;
}

export const DiceBagsSection: React.FC<DiceBagsSectionProps> = ({
	activeBags,
	depletedBags,
	totalBags,
	onDiceLeftClick,
	onDiceRightClick,
	onBuyClick,
}) => {
	const hasBags = activeBags.length > 0 || depletedBags.length > 0;

	return (
		<InventorySection title="Your Dice" count={totalBags} layout="grid">
			{hasBags ? (
				<>
					{activeBags.map((bag) => (
						<SvmDiceBagSlot
							key={bag.mint}
							diceBag={bag}
							onLeftClick={onDiceLeftClick}
							onRightClick={onDiceRightClick(bag)}
						/>
					))}
					{depletedBags.map((bag) => (
						<SvmDiceBagSlot
							key={bag.mint}
							diceBag={bag}
							onLeftClick={onDiceLeftClick}
							onRightClick={onDiceRightClick(bag)}
						/>
					))}
					<BuyDiceBagSlot onClick={onBuyClick} />
				</>
			) : (
				<Stack gap={2} style={{ textAlign: "center", gridColumn: "1 / -1" }}>
					<Typography
						variant="muted"
						size="xs"
						style={{ padding: "4px 8px" }}
					>
						No dice bags yet.
					</Typography>
					<BuyDiceBagSlot onClick={onBuyClick} />
				</Stack>
			)}
		</InventorySection>
	);
};
