/**
 * SvmDiceBagSlot — Displays a single SVM dice bag in the inventory panel.
 *
 * Matches EVM DiceItemSlot: selection state visuals, left-click to enter
 * selection mode, right-click for context menu.
 */

import { Card, Typography, useSelectionStore } from "@anterra/tex-ui-kit";
import type React from "react";
import type { MouseEventHandler } from "react";
import type { SvmDiceBag } from "../../../api";
import styles from "./SvmInventory.module.scss";

interface SvmDiceBagSlotProps {
	diceBag: SvmDiceBag;
	onLeftClick?: (diceBag: SvmDiceBag) => void;
	onRightClick?: MouseEventHandler<HTMLDivElement>;
}

const MAX_PIPS = 10;

export const SvmDiceBagSlot: React.FC<SvmDiceBagSlotProps> = ({
	diceBag,
	onLeftClick,
	onRightClick,
}) => {
	const isDepleted = diceBag.usesRemaining <= 0;
	const isLowUses = diceBag.usesRemaining <= 3;

	// Selection state
	const mode = useSelectionStore((s) => s.mode);
	const source = useSelectionStore((s) => s.source);

	// Check if this dice bag is the source of current selection
	const isSelectionSource =
		mode !== "none" && source?.type === "dice" && source.id === diceBag.mint;

	// Check if we're in any selection mode
	const isInSelectionMode = mode !== "none";

	const handleClick = (event: React.MouseEvent) => {
		if (event.button === 0 && onLeftClick) {
			onLeftClick(diceBag);
		}
	};

	// Determine card variant based on state
	const variant = isDepleted
		? "danger"
		: isSelectionSource
			? "elevated"
			: "inset";

	// Build class names
	const classNames = [styles.diceBagCard];
	if (isSelectionSource) classNames.push(styles.selectionSource);
	if (isInSelectionMode && !isSelectionSource) classNames.push(styles.dimmed);
	if (isDepleted) classNames.push(styles.diceBagCardDepleted);

	// Truncate mint for title
	const mintShort = `${diceBag.mint.slice(0, 4)}...${diceBag.mint.slice(-4)}`;

	return (
		<Card
			variant={variant}
			size="sm"
			interactive={!isDepleted}
			onClick={handleClick}
			onContextMenu={onRightClick}
			title={`Dice Bag ${mintShort} — ${diceBag.usesRemaining}/${MAX_PIPS} uses remaining`}
			className={classNames.join(" ")}
			style={{
				width: 38,
				height: 52,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				position: "relative",
				padding: "4px 2px",
				gap: 2,
			}}
		>
			{/* Dice icon */}
			<div className={styles.diceIcon}>🎲</div>

			{/* Uses remaining */}
			<Typography
				as="span"
				variant={isLowUses ? "error" : "muted"}
				size="xs"
				style={{ fontSize: 9 }}
			>
				{diceBag.usesRemaining}/{MAX_PIPS}
			</Typography>

			{/* Pips showing uses remaining */}
			<div className={styles.rollPipsCompact}>
				{Array.from({ length: MAX_PIPS }).map((_, i) => (
					<div
						key={i}
						className={`${styles.rollPipSmall} ${
							i < diceBag.usesRemaining
								? isLowUses
									? styles.rollPipLow
									: styles.rollPipActive
								: ""
						}`}
					/>
				))}
			</div>
		</Card>
	);
};
