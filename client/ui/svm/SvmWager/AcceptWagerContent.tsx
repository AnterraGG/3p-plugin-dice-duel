import { GameWindow } from "@townexchange/tex-ui-kit";
import type { SvmWager } from "../../../api";
import { AcceptWagerSvm } from "./AcceptWagerSvm";

export default function AcceptWagerContent({
	wager,
	onClose,
}: {
	wager: SvmWager;
	onClose: () => void;
}) {
	return (
		<GameWindow
			id="dragon-dice:incoming-wager"
			title="Dice Duel — Incoming"
			size="md"
			isOpen
			onClose={onClose}
			overlay={false}
			modal={false}
			draggable
			escapable
			position={{ x: "3%", y: "15%" }}
		>
			<AcceptWagerSvm wager={wager} onClose={onClose} />
		</GameWindow>
	);
}
