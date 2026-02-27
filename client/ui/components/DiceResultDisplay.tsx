/**
 * DiceResultDisplay - Visual dice roll result component
 */

import type React from "react";
import styles from "./components.module.scss";

interface DiceResultDisplayProps {
	diceTotal: number;
	showOddEven?: boolean;
	size?: "sm" | "md" | "lg";
}

// Convert total back to two dice values (for visual display)
const splitDiceTotal = (total: number): [number, number] => {
	// Try to make it look natural by splitting evenly when possible
	const half = Math.floor(total / 2);
	const die1 = Math.min(6, Math.max(1, half));
	const die2 = Math.min(6, Math.max(1, total - die1));
	return [die1, die2];
};

export const DiceResultDisplay: React.FC<DiceResultDisplayProps> = ({
	diceTotal,
	showOddEven = true,
	size = "md",
}) => {
	const [die1, die2] = splitDiceTotal(diceTotal);
	const isEven = diceTotal % 2 === 0;

	const sizeStyles = {
		sm: { die: 20, total: 14, text: 9, gap: 4 },
		md: { die: 28, total: 20, text: 11, gap: 6 },
		lg: { die: 40, total: 28, text: 13, gap: 8 },
	};

	const s = sizeStyles[size];

	return (
		<div className={styles.diceResultContainer} style={{ gap: s.gap }}>
			<span
				className={styles.diceResultDie}
				style={{ width: s.die, height: s.die, fontSize: s.total * 0.65 }}
			>
				{die1}
			</span>
			<span className={styles.diceResultOperator} style={{ fontSize: s.text }}>
				+
			</span>
			<span
				className={styles.diceResultDie}
				style={{ width: s.die, height: s.die, fontSize: s.total * 0.65 }}
			>
				{die2}
			</span>
			<span className={styles.diceResultOperator} style={{ fontSize: s.text }}>
				=
			</span>
			<span className={styles.diceResultTotal} style={{ fontSize: s.total }}>
				{diceTotal}
			</span>
			{showOddEven && (
				<span className={styles.diceResultOddEven} style={{ fontSize: s.text }}>
					({isEven ? "Even" : "Odd"})
				</span>
			)}
		</div>
	);
};
