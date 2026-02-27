/**
 * InventorySection — Collapsible section wrapper for inventory panels.
 * Lightweight replacement after EVM code strip.
 */

import { Flex, Typography } from "@townexchange/tex-ui-kit";
import type React from "react";

interface InventorySectionProps {
	title: string;
	count?: number;
	layout?: "grid" | "stack";
	collapsed?: boolean;
	onToggle?: () => void;
	children: React.ReactNode;
}

export const InventorySection: React.FC<InventorySectionProps> = ({
	title,
	count,
	layout = "stack",
	collapsed = false,
	onToggle,
	children,
}) => {
	return (
		<div>
			<Flex
				align="center"
				justify="between"
				style={{
					cursor: onToggle ? "var(--cursor-pointer, pointer)" : undefined,
					padding: "2px 0",
				}}
				onClick={onToggle}
			>
				<Typography variant="muted" size="xs" bold>
					{title}
					{count !== undefined && (
						<span style={{ opacity: 0.6, marginLeft: 4 }}>({count})</span>
					)}
				</Typography>
				{onToggle && (
					<Typography variant="muted" size="xs">
						{collapsed ? "▸" : "▾"}
					</Typography>
				)}
			</Flex>

			{!collapsed && (
				<div
					style={{
						display: layout === "grid" ? "grid" : "flex",
						flexDirection: layout === "stack" ? "column" : undefined,
						gridTemplateColumns:
							layout === "grid"
								? "repeat(auto-fill, minmax(48px, 1fr))"
								: undefined,
						gap: layout === "grid" ? 4 : 2,
						marginTop: 2,
					}}
				>
					{children}
				</div>
			)}
		</div>
	);
};
