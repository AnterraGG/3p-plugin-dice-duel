/**
 * SvmShopContent — Window wrapper for the SVM shop.
 */

import { GameWindow } from "@townexchange/tex-ui-kit";
import { SvmShop } from "./SvmShop";

export default function SvmShopContent({ onClose }: { onClose: () => void }) {
	return (
		<GameWindow
			id="dragon-dice:shop"
			title="Dragon Dice Shop"
			size="sm"
			isOpen
			onClose={onClose}
			inputMode="blocking"
			overlay={false}
			modal={false}
			draggable
			escapable
			position={{ x: "3%", y: "15%" }}
		>
			<SvmShop />
		</GameWindow>
	);
}
