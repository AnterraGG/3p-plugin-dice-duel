/**
 * BalanceFloatRenderSystem
 *
 * Renders floating "+0.05 [icon] SOL" text above the player when a wager
 * resolves. Layout: [amountText] [coinIcon] [tickerText], all centered as
 * a group. All visual elements are ECS entities so they go through the same
 * TransformSystem pipeline and stay in sync during camera/player movement.
 */

import type { PluginSystemContext } from "@townexchange/3p-plugin-sdk/client";
import {
	createGraphicsEntity,
	createSpriteEntity,
	createTextEntity,
} from "@townexchange/3p-plugin-sdk/client";
import type { PluginWorld } from "@townexchange/3p-plugin-sdk/ecs";
import { removeEntity } from "@townexchange/3p-plugin-sdk/ecs";
import { TOKEN_ICONS } from "@townexchange/token-icons";
import { DICE_DUEL_ANIMATION, DICE_DUEL_DEPTHS } from "../../shared/constants";
import { registerCleanupCallback } from "../state";
import { useDiceDuelGameStore } from "../store/diceDuelGameStore";

const TICKER_ICON_SIZE = 32; // desired display width in pixels
const TICKER_ICON_GAP = 5; // px gap between icon and adjacent text
// Text origin is (0.5, 0): horizontally centered, anchored at top.
// fontSize 28 + strokeThickness 4 (2px each side) ≈ 32px total height.
// The icon (origin 0.5,0.5) center must be offset down by half text height.
const TICKER_TEXT_HEIGHT = 32;

// Coin circle: slightly larger than the icon so it forms a visible border
const COIN_RADIUS = TICKER_ICON_SIZE / 2 + 4;
const COIN_FILL_COLOR = 0x0a0a1a;
const COIN_STROKE_COLOR = 0xffffff;
const COIN_STROKE_WIDTH = 1.5;

interface FloatVisual {
	/** Amount text entity, e.g. "+0.01" (or full text when no icon) */
	textEid: number;
	/** Ticker label entity, e.g. "SOL" — only set when icon exists */
	tickerTextEid: number | null;
	iconEid: number | null;
	/** Coin circle background — ECS graphics entity, synced through the same pipeline as iconEid */
	coinCircleEid: number | null;
}

export function createBalanceFloatRenderSystem() {
	const floatVisuals = new Map<string, FloatVisual>();
	/** Tracks balance floats that have already triggered camera FX. */
	const fxFired = new Set<string>();
	let cleanupRegistered = false;
	let capturedWorld: PluginWorld | null = null;

	return (world: PluginWorld, ctx: PluginSystemContext) => {
		capturedWorld = world;
		const { Position, Sprite, TextDisplay } = ctx.components;

		if (!cleanupRegistered) {
			registerCleanupCallback(() => {
				if (capturedWorld) {
					for (const [, visual] of floatVisuals) {
						removeEntity(capturedWorld, visual.textEid);
						if (visual.tickerTextEid != null)
							removeEntity(capturedWorld, visual.tickerTextEid);
						if (visual.iconEid != null)
							removeEntity(capturedWorld, visual.iconEid);
						if (visual.coinCircleEid != null)
							removeEntity(capturedWorld, visual.coinCircleEid);
					}
				}
				floatVisuals.clear();
			});
			cleanupRegistered = true;
		}

		const store = useDiceDuelGameStore.getState();
		const activeIds = new Set<string>();

		for (const [id, float] of store.balanceFloats) {
			activeIds.add(id);

			let visual = floatVisuals.get(id);

			if (!visual) {
				const amountText = float.isPositive
					? `+${float.amount}`
					: `-${float.amount}`;

				const worldX =
					float.entityId != null
						? Position.worldX[float.entityId]
						: float.position.x;
				const worldY =
					float.entityId != null
						? Position.worldY[float.entityId]
						: float.position.y;

				const depth = DICE_DUEL_DEPTHS.CELEBRATION + 1;

				const textStyle = {
					fontFamily: "Tickerbit" as const,
					fontSize: 28,
					textColor: float.isPositive ? 0x22c55e : 0xef4444,
					strokeThickness: 4,
					strokeColor: 0x000000,
					depth,
					scale: 0,
					alpha: 1,
				};

				const resolvedTexture =
					float.tickerImage ??
					TOKEN_ICONS[float.ticker as keyof typeof TOKEN_ICONS]?.textureKey;

				if (resolvedTexture) {
					// 3-part layout: amount text | coin icon | ticker text
					const textEid = createTextEntity(world, ctx, {
						worldX,
						worldY: worldY - 20,
						content: amountText,
						...textStyle,
					});

					const tickerTextEid = createTextEntity(world, ctx, {
						worldX,
						worldY: worldY - 20,
						content: float.ticker,
						...textStyle,
					});

					const coinCircleGfx = ctx.services.render
						.createGraphics()
						.setScrollFactor(1, 1)
						.fillStyle(COIN_FILL_COLOR, 1)
						.fillCircle(0, 0, COIN_RADIUS)
						.lineStyle(COIN_STROKE_WIDTH, COIN_STROKE_COLOR, 0.6)
						.strokeCircle(0, 0, COIN_RADIUS);

					const coinCircleEid = createGraphicsEntity(world, ctx, {
						worldX,
						worldY: worldY - 20,
						graphics: coinCircleGfx,
						depth: depth - 0.5,
						alpha: 1,
						scale: 0,
					});

					const iconEid = createSpriteEntity(world, ctx, {
						worldX,
						worldY: worldY - 20,
						textureKey: resolvedTexture,
						depth,
						scale: 0,
						alpha: 1,
					});

					visual = { textEid, tickerTextEid, iconEid, coinCircleEid };
				} else {
					// No icon: single combined text
					const textEid = createTextEntity(world, ctx, {
						worldX,
						worldY: worldY - 20,
						content: `${amountText} ${float.ticker}`,
						...textStyle,
					});

					visual = {
						textEid,
						tickerTextEid: null,
						iconEid: null,
						coinCircleEid: null,
					};
				}

				floatVisuals.set(id, visual);

				// Camera FX: green flash on positive payout
				if (float.isPositive && !fxFired.has(id)) {
					fxFired.add(id);
					ctx.services.cameraController.flash({
						color: 0x22c55e,
						alpha: 0.25,
						durationMs: 150,
					});
				}
			}

			const elapsed = Date.now() - float.startTime;
			const totalDuration = DICE_DUEL_ANIMATION.BALANCE_FLOAT_DURATION;
			const holdDuration = DICE_DUEL_ANIMATION.BALANCE_FLOAT_HOLD;
			const fadeDuration = totalDuration - holdDuration;
			const progress = Math.min(elapsed / totalDuration, 1);

			const baseWorldX =
				float.entityId != null
					? Position.worldX[float.entityId]
					: float.position.x;
			const baseWorldY =
				float.entityId != null
					? Position.worldY[float.entityId]
					: float.position.y;

			const floatOffset = progress * 70;
			const currentWorldY = baseWorldY - 20 - floatOffset;

			let alpha: number;
			if (elapsed < holdDuration) {
				alpha = 1;
			} else {
				const fadeProgress = Math.min(
					(elapsed - holdDuration) / fadeDuration,
					1,
				);
				alpha = 1 - fadeProgress * fadeProgress;
			}

			const popDuration = 300;
			let scale: number;
			if (elapsed < popDuration) {
				const t = elapsed / popDuration;
				scale = t * (1.0 + 0.25 * Math.sin(t * Math.PI));
			} else {
				scale = 1.0;
			}

			if (
				visual.iconEid != null &&
				visual.tickerTextEid != null &&
				visual.coinCircleEid != null
			) {
				const { GraphicsDisplay } = ctx.components;

				// 3-part layout: [amountText] [icon] [tickerText] centered at baseWorldX
				const rawWidth = ctx.entities.getSpriteWidth(visual.iconEid);
				if (rawWidth > 0) {
					Sprite.scale[visual.iconEid] = (TICKER_ICON_SIZE / rawWidth) * scale;
				}

				const amountW = ctx.entities.getTextWidth(visual.textEid) * scale;
				const tickerW = ctx.entities.getTextWidth(visual.tickerTextEid) * scale;
				const iconW = TICKER_ICON_SIZE * scale;
				const totalW =
					amountW + TICKER_ICON_GAP + iconW + TICKER_ICON_GAP + tickerW;

				const leftEdge = baseWorldX - totalW / 2;
				const amountX = leftEdge + amountW / 2;
				const iconX = leftEdge + amountW + TICKER_ICON_GAP + iconW / 2;
				const tickerX =
					leftEdge +
					amountW +
					TICKER_ICON_GAP +
					iconW +
					TICKER_ICON_GAP +
					tickerW / 2;

				// Text origin (0.5, 0): top-anchored. Icon center offset down by half text height.
				const iconY = currentWorldY + (TICKER_TEXT_HEIGHT * scale) / 2;

				Position.worldX[visual.textEid] = amountX;
				Position.worldY[visual.textEid] = currentWorldY;
				TextDisplay.alpha[visual.textEid] = alpha;
				TextDisplay.scale[visual.textEid] = scale;

				Position.worldX[visual.tickerTextEid] = tickerX;
				Position.worldY[visual.tickerTextEid] = currentWorldY;
				TextDisplay.alpha[visual.tickerTextEid] = alpha;
				TextDisplay.scale[visual.tickerTextEid] = scale;

				Position.worldX[visual.iconEid] = iconX;
				Position.worldY[visual.iconEid] = iconY;
				Sprite.alpha[visual.iconEid] = alpha;

				// Coin circle — same ECS pipeline as the icon, so no frame lag
				Position.worldX[visual.coinCircleEid] = iconX;
				Position.worldY[visual.coinCircleEid] = iconY;
				GraphicsDisplay.alpha[visual.coinCircleEid] = alpha;
				GraphicsDisplay.scale[visual.coinCircleEid] = scale;
			} else {
				// No icon: single centered text
				Position.worldX[visual.textEid] = baseWorldX;
				Position.worldY[visual.textEid] = currentWorldY;
				TextDisplay.alpha[visual.textEid] = alpha;
				TextDisplay.scale[visual.textEid] = scale;
			}

			if (progress >= 1) {
				store.removeBalanceFloat(id);
			}
		}

		// Clean up visuals for removed floats
		for (const [id, visual] of floatVisuals) {
			if (!activeIds.has(id)) {
				removeEntity(world, visual.textEid);
				if (visual.tickerTextEid != null)
					removeEntity(world, visual.tickerTextEid);
				if (visual.iconEid != null) removeEntity(world, visual.iconEid);
				if (visual.coinCircleEid != null)
					removeEntity(world, visual.coinCircleEid);
				floatVisuals.delete(id);
				fxFired.delete(id);
			}
		}

		return world;
	};
}
