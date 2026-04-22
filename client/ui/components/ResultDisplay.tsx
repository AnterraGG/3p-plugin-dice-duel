/**
 * ResultDisplay - Win/Lose result display with animations
 */

import { Button, Flex, Typography } from "@anterra/tex-ui-kit";
import type React from "react";
import { formatTokenAmount, getTokenSymbol } from "../../../shared/tokenUtils";
import { DiceResultDisplay } from "./DiceResultDisplay";
import styles from "./components.module.scss";

interface ResultDisplayProps {
	isWinner: boolean;
	diceTotal: number;
	prizeAmount?: bigint;
	wagerToken: string;
	showClaimButton?: boolean;
	onClaim?: () => void;
	isClaimPending?: boolean;
}

export const ResultDisplay: React.FC<ResultDisplayProps> = ({
	isWinner,
	diceTotal,
	prizeAmount,
	wagerToken,
	showClaimButton = false,
	onClaim,
	isClaimPending = false,
}) => {
	const tokenSymbol = getTokenSymbol(wagerToken);

	return (
		<div
			className={`${styles.resultDisplay} ${isWinner ? styles.resultWin : styles.resultLose}`}
		>
			{/* Emoji */}
			<div className={styles.resultEmoji}>{isWinner ? "🏆" : "😔"}</div>

			{/* Title */}
			<div
				className={`${styles.resultTitle} ${isWinner ? styles.resultTitleWin : styles.resultTitleLose}`}
			>
				{isWinner ? "You Won!" : "You Lost"}
			</div>

			{/* Dice Result */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 4,
				}}
			>
				<DiceResultDisplay
					diceTotal={diceTotal}
					size="md"
					showOddEven={false}
				/>
				<Typography
					variant="muted"
					size="xs"
					style={{ textTransform: "uppercase", letterSpacing: 1 }}
				>
					{diceTotal % 2 === 0 ? "Even" : "Odd"}
				</Typography>
			</div>

			{/* Prize Amount */}
			{isWinner && prizeAmount !== undefined && (
				<Flex justify="center" style={{ marginTop: 12 }}>
					<Typography
						variant="gold"
						size="md"
						bold
						style={{ textShadow: "0 0 8px rgba(255, 215, 0, 0.4)" }}
					>
						Prize: {formatTokenAmount(prizeAmount, wagerToken)} {tokenSymbol}
					</Typography>
				</Flex>
			)}

			{/* Claim Button */}
			{showClaimButton && isWinner && onClaim && (
				<Flex justify="center" style={{ marginTop: 16 }}>
					<Button variant="primary" onClick={onClaim} disabled={isClaimPending}>
						{isClaimPending ? "Claiming..." : "Claim Prize"}
					</Button>
				</Flex>
			)}
		</div>
	);
};
