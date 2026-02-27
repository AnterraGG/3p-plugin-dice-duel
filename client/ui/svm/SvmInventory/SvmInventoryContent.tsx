/**
 * SvmInventoryContent — Window wrapper for the SVM inventory.
 */

import { GameWindow } from "@townexchange/tex-ui-kit";
import { SvmInventory } from "./SvmInventory";

export default function SvmInventoryContent({
	onClose,
}: { onClose: () => void }) {
	return (
		<GameWindow
			id="dice-duel:inventory"
			title="Dice Duel"
			size="sm"
			isOpen
			onClose={onClose}
			overlay={false}
			modal={false}
			draggable
			escapable
			position={{ x: "3%", y: "15%" }}
		>
			<SvmInventory />
		</GameWindow>
	);
}
