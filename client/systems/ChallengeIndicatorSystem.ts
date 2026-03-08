/**
 * ChallengeIndicatorSystem
 *
 * Shows a bouncing challenge icon above the challenger's entity.
 * Uses ECS entities with world-space positioning — the engine pipeline
 * handles coordinate transforms, sprite lifecycle, and visual property sync.
 *
 * Also updates local player position/entityId in module state for UI components.
 */

import type { PluginSystemContext } from "@townexchange/3p-plugin-sdk/client";
import { createSpriteEntity } from "@townexchange/3p-plugin-sdk/client";
import type { PluginWorld } from "@townexchange/3p-plugin-sdk/ecs";
import {
	type PluginComponent,
	hasComponent,
	removeEntity,
} from "@townexchange/3p-plugin-sdk/ecs";
import { assets } from "../../shared/assets";
import {
	DICE_DUEL_ANIMATION,
	DICE_DUEL_DEPTHS,
	DICE_DUEL_SCALES,
} from "../../shared/constants";
import {
	registerCleanupCallback,
	setLocalPlayerEntityId,
	setLocalPlayerPosition,
} from "../state";
import { useDiceDuelGameStore } from "../store/diceDuelGameStore";

interface IndicatorVisual {
	spriteEid: number;
	targetEntityId: number;
}

export function createChallengeIndicatorSystem() {
	const indicatorVisuals = new Map<string, IndicatorVisual>();
	/** Tracks challenges that have already triggered camera FX. */
	const fxFired = new Set<string>();
	let cleanupRegistered = false;
	let capturedWorld: PluginWorld | null = null;

	return (world: PluginWorld, ctx: PluginSystemContext) => {
		capturedWorld = world;
		const { Position, Sprite } = ctx.components;

		// Update local player position for UI components
		const localPlayer = ctx.identity.getLocalPlayer();
		if (localPlayer?.entityId !== null && localPlayer?.entityId !== undefined) {
			const eid = localPlayer.entityId;
			setLocalPlayerEntityId(eid);
			if (hasComponent(world, Position as unknown as PluginComponent, eid)) {
				const wx = Position.worldX[eid];
				const wy = Position.worldY[eid];
				if (wx !== undefined && wy !== undefined) {
					setLocalPlayerPosition({ x: wx, y: wy });
				}
			}
		}

		if (!cleanupRegistered) {
			registerCleanupCallback(() => {
				if (capturedWorld) {
					for (const [, visual] of indicatorVisuals) {
						removeEntity(capturedWorld, visual.spriteEid);
					}
				}
				indicatorVisuals.clear();
			});
			cleanupRegistered = true;
		}

		const store = useDiceDuelGameStore.getState();
		const activeWagerIds = new Set<string>();

		for (const [wagerId, indicator] of store.challengeIndicators) {
			activeWagerIds.add(wagerId);

			const entityId =
				ctx.identity.getPlayerBySvmAddress(indicator.challengerAddress)
					?.entityId ?? null;

			// Target entity not found or missing Position — hide if visual exists
			if (
				entityId === null ||
				!hasComponent(world, Position as unknown as PluginComponent, entityId)
			) {
				const visual = indicatorVisuals.get(wagerId);
				if (visual) {
					Sprite.visible[visual.spriteEid] = 0;
				}
				continue;
			}

			let visual = indicatorVisuals.get(wagerId);

			// Target entity changed — destroy old visual, create new
			if (visual && visual.targetEntityId !== entityId) {
				removeEntity(world, visual.spriteEid);
				indicatorVisuals.delete(wagerId);
				visual = undefined;
			}

			if (!visual) {
				const spriteEid = createSpriteEntity(world, ctx, {
					worldX: Position.worldX[entityId],
					worldY: Position.worldY[entityId] - 40,
					textureKey: assets.textures.challenge as string,
					depth: DICE_DUEL_DEPTHS.CHALLENGE_INDICATOR,
					scale: DICE_DUEL_SCALES.CHALLENGE_INDICATOR,
					originX: 0.5,
					originY: 1,
				});

				visual = { spriteEid, targetEntityId: entityId };
				indicatorVisuals.set(wagerId, visual);

				// Camera FX: vignette when local player receives a challenge
				if (!fxFired.has(wagerId)) {
					fxFired.add(wagerId);
					ctx.services.cameraController.vignette({
						intensity: 0.3,
						durationMs: 2000,
					});
				}
			}

			// Follow target entity's world position
			const targetWorldX = Position.worldX[entityId];
			const targetWorldY = Position.worldY[entityId];

			const elapsed = Date.now() - indicator.startTime;
			const pulse =
				1 +
				Math.sin(
					(elapsed / DICE_DUEL_ANIMATION.CHALLENGE_PULSE_SPEED) * Math.PI * 2,
				) *
					0.15;
			const bounce = Math.sin((elapsed / 300) * Math.PI * 2) * 5;

			Position.worldX[visual.spriteEid] = targetWorldX;
			Position.worldY[visual.spriteEid] = targetWorldY - 40 + bounce;
			Sprite.scale[visual.spriteEid] =
				DICE_DUEL_SCALES.CHALLENGE_INDICATOR * pulse;
			Sprite.visible[visual.spriteEid] = 1;
		}

		// Clean up visuals for removed indicators
		for (const [wagerId, visual] of indicatorVisuals) {
			if (!activeWagerIds.has(wagerId)) {
				removeEntity(world, visual.spriteEid);
				indicatorVisuals.delete(wagerId);
				fxFired.delete(wagerId);
			}
		}

		return world;
	};
}
