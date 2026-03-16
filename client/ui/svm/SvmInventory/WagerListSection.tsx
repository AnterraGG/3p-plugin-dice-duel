/**
 * WagerListSection — Reusable wager list wrapped in InventorySection.
 * Used for Incoming, Claimable, Pending, and Active sections.
 */

import { ScrollableElement } from "@townexchange/tex-ui-kit";
import type React from "react";
import type { MouseEventHandler } from "react";
import type { SvmWager } from "../../../api";
import { InventorySection } from "./InventorySection";
import { SvmWagerSlot } from "./SvmWagerSlot";

interface WagerListSectionProps {
	title: string;
	wagers: SvmWager[];
	walletAddress: string;
	onWagerClick: (wager: SvmWager) => void;
	onWagerRightClick: (wager: SvmWager) => MouseEventHandler<HTMLDivElement>;
}

export const WagerListSection: React.FC<WagerListSectionProps> = ({
	title,
	wagers,
	walletAddress,
	onWagerClick,
	onWagerRightClick,
}) => {
	if (wagers.length === 0) return null;

	return (
		<InventorySection title={title} count={wagers.length} layout="stack">
			<ScrollableElement variant="thin" direction="vertical" maxHeight={250}>
				{wagers.map((wager) => (
					<SvmWagerSlot
						key={wager.address}
						wager={wager}
						walletAddress={walletAddress}
						onClick={onWagerClick}
						onRightClick={onWagerRightClick(wager)}
					/>
				))}
			</ScrollableElement>
		</InventorySection>
	);
};
