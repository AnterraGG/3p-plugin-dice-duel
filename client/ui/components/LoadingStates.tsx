/**
 * Loading state components with Dice Duel theming
 */

import { Typography } from "@anterra/tex-ui-kit";
import type React from "react";
import styles from "./components.module.scss";

export const DiceLoadingSpinner: React.FC<{ text?: string }> = ({
	text = "Loading...",
}) => {
	return (
		<div className={styles.loadingContainer}>
			<div className={styles.loadingDice}>🎲</div>
			<Typography variant="muted" size="sm">
				{text}
			</Typography>
		</div>
	);
};

export const SimpleSpinner: React.FC = () => {
	return <div className={styles.loadingSpinner} />;
};

export const RollingDice: React.FC = () => {
	return (
		<div className={styles.loadingContainer}>
			<div className={styles.loadingDice}>🎲🎲</div>
			<Typography variant="muted" size="sm">
				Rolling dice...
			</Typography>
		</div>
	);
};
