/**
 * CelebrationRenderSystem (3p SDK version)
 *
 * Uses UIService entity anchors to follow the player entity,
 * with fallback to world-space position when entity is unavailable.
 */

import type {
	EntityAnchorOptions,
	IGraphics,
	IText,
	PluginSystemContext,
	UIAnchorHandle,
} from "@townexchange/3p-plugin-sdk/client";
import type { PluginWorld } from "@townexchange/3p-plugin-sdk/ecs";
import {
	DRAGON_DICE_ANIMATION,
	DRAGON_DICE_DEPTHS,
} from "../../shared/constants";
import {
	registerCleanupCallback,
	registerGraphics,
	registerText,
	unregisterGraphics,
	unregisterText,
} from "../state";
import { useDragonDiceGameStore } from "../store/dragonDiceGameStore";

interface CelebrationVisuals {
	text: IText;
	graphics: IGraphics;
	anchor: UIAnchorHandle<EntityAnchorOptions> | null;
}

export function createCelebrationRenderSystem() {
	const celebrationVisuals: Map<string, CelebrationVisuals> = new Map();
	let cleanupRegistered = false;

	return (world: PluginWorld, ctx: PluginSystemContext) => {
		const render = ctx.services.render;

		if (!cleanupRegistered) {
			registerCleanupCallback(() => {
				for (const [, visuals] of celebrationVisuals) {
					unregisterText(visuals.text);
					unregisterGraphics(visuals.graphics);
					visuals.text.destroy();
					visuals.graphics.destroy();
					visuals.anchor?.release();
				}
				celebrationVisuals.clear();
			});
			cleanupRegistered = true;
		}

		const store = useDragonDiceGameStore.getState();
		const activeIds = new Set<string>();

		for (const [id, celebration] of store.celebrations) {
			activeIds.add(id);

			let visuals = celebrationVisuals.get(id);

			if (!visuals) {
				const text = render.createText(0, 0, "", {
					fontFamily: "Tickerbit",
					fontSize: celebration.type === "win" ? "48px" : "32px",
					color: celebration.type === "win" ? "#ffd700" : "#888888",
					stroke: "#000000",
					strokeThickness: celebration.type === "win" ? 6 : 4,
				});
				text.setOrigin(0.5, 0.5);
				text.setDepth(DRAGON_DICE_DEPTHS.CELEBRATION);
				text.setScrollFactor(1, 1);
				registerText(text);

				const graphics = render.createGraphics();
				graphics.setDepth(DRAGON_DICE_DEPTHS.CELEBRATION - 1);
				graphics.setScrollFactor(1, 1);
				registerGraphics(graphics);

				// Create entity anchor if entityId is available
				const anchor =
					celebration.entityId != null
						? ctx.services.ui.createEntityAnchor({
								targetEntityId: celebration.entityId,
								anchor: "top-center",
								offsetY: -60,
							})
						: null;

				visuals = { text, graphics, anchor };
				celebrationVisuals.set(id, visuals);
			}

			const { text, graphics, anchor } = visuals;
			const elapsed = Date.now() - celebration.startTime;
			const totalDuration = DRAGON_DICE_ANIMATION.CELEBRATION_DURATION;
			const holdDuration = DRAGON_DICE_ANIMATION.CELEBRATION_HOLD;
			const fadeDuration = totalDuration - holdDuration;

			// Use entity anchor position, fall back to world-space position
			let worldPos: { x: number; y: number };
			if (anchor) {
				worldPos = anchor.getPosition();
			} else {
				// Use world coords directly — Phaser camera handles scroll + zoom
				worldPos = celebration.position;
			}

			// Gentle float: only 30px over the full duration
			const floatProgress = Math.min(elapsed / totalDuration, 1);
			const floatOffset = floatProgress * 30;
			const yPos = worldPos.y - floatOffset;

			// Alpha: fully visible during hold, then fade out with ease
			let alpha: number;
			if (elapsed < holdDuration) {
				alpha = 1;
			} else {
				const fadeProgress = Math.min(
					(elapsed - holdDuration) / fadeDuration,
					1,
				);
				// Ease-out: stays visible longer before dropping
				alpha = 1 - fadeProgress * fadeProgress;
			}

			if (celebration.type === "win") {
				text.setText("YOU WON!");
				text.setPosition(worldPos.x, yPos);
				text.setAlpha(alpha);

				// Pop-in scale: starts at 0, overshoots to 1.3, settles to 1.0
				const popDuration = 400; // ms for the pop-in
				let baseScale: number;
				if (elapsed < popDuration) {
					const t = elapsed / popDuration;
					// Overshoot ease: cubic out with overshoot
					const overshoot = 1.0 + 0.3 * Math.sin(t * Math.PI);
					baseScale = t * overshoot;
				} else {
					baseScale = 1.0;
				}

				// Gentle pulse on top of base scale
				const pulse = 1 + Math.sin(elapsed / 150) * 0.06;
				text.setScale(baseScale * pulse);

				// Particles — more of them, bigger, with color variety
				graphics.clear();
				const particleCount = 14;
				const colors = [0xffd700, 0xffaa00, 0xffee55, 0xffffff];
				for (let i = 0; i < particleCount; i++) {
					const angle = (i / particleCount) * Math.PI * 2 + elapsed / 400;
					const radius = 40 + Math.sin(elapsed / 180 + i) * 15;
					const px = worldPos.x + Math.cos(angle) * radius;
					const py = yPos + Math.sin(angle) * radius;

					const color = colors[i % colors.length];
					const particleSize = 3 + Math.sin(elapsed / 120 + i * 0.7) * 1.5;
					graphics.fillStyle(color, alpha * 0.85);
					graphics.fillCircle(px, py, particleSize);
				}

				// Inner glow ring
				graphics.lineStyle(2, 0xffd700, alpha * 0.3);
				const glowRadius = 55 + Math.sin(elapsed / 250) * 8;
				graphics.strokeCircle(worldPos.x, yPos, glowRadius);
			} else {
				text.setText("You Lost");
				text.setPosition(worldPos.x, yPos);
				text.setAlpha(alpha * 0.7);
				text.setScale(0.8);

				graphics.clear();
			}

			text.setVisible(true);
			graphics.setVisible(true);

			if (elapsed >= totalDuration) {
				store.removeCelebration(id);
			}
		}

		for (const [id, visuals] of celebrationVisuals) {
			if (!activeIds.has(id)) {
				unregisterText(visuals.text);
				unregisterGraphics(visuals.graphics);
				visuals.text.destroy();
				visuals.graphics.destroy();
				visuals.anchor?.release();
				celebrationVisuals.delete(id);
			}
		}

		return world;
	};
}
