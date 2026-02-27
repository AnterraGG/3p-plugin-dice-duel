import { GameWindow } from "@townexchange/tex-ui-kit";
import { InitiateWagerSvm } from "./InitiateWagerSvm";

export default function InitiateWagerContent({
	onClose,
	opponentAddress,
	opponentName,
	diceBagMint,
}: {
	onClose: () => void;
	opponentAddress?: string;
	opponentName?: string;
	diceBagMint?: string;
}) {
	return (
		<GameWindow
			id="dice-duel:initiate-wager"
			title="Dice Duel — Challenge"
			size="md"
			isOpen
			onClose={onClose}
			overlay={false}
			modal={false}
			draggable
			escapable
			position={{ x: "3%", y: "15%" }}
		>
			<InitiateWagerSvm
				defaultOpponent={opponentAddress}
				opponentName={opponentName}
				diceBagMint={diceBagMint}
				onClose={onClose}
			/>
		</GameWindow>
	);
}
