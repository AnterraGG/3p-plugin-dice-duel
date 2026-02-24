/**
 * DiceRollRenderSystem — Realistic Thrown Dice
 *
 * Simulates a physical dice throw:
 * 1. THROW: Dice arc from character outward (parabolic toss)
 * 2. BOUNCE: Discrete parabolic bounces with decreasing height
 *    - Squash on impact, face change on impact, spin decelerates
 * 3. SETTLE: Damped wobble as dice rock to rest
 * 4. IDLE: Subtle breathing pulse until result arrives
 *
 * Each die is independently randomized — different bounce heights,
 * spin speeds, tumble rates, throw timing, and trajectories.
 */

import type {
	ISprite,
	PluginSystemContext,
	ScreenAnchorOptions,
	UIAnchorHandle,
} from "@townexchange/3p-plugin-sdk/client";
import type { PluginWorld } from "@townexchange/3p-plugin-sdk/ecs";
import {
	DICE_FACE_COUNT,
	DICE_TEXTURE_PREFIX,
	DRAGON_DICE_ANIMATION,
	DRAGON_DICE_DEPTHS,
	DRAGON_DICE_SCALES,
} from "../../shared/constants";
import { getHighLowDicePair } from "../../shared/dice-faces";
import { playLandSound } from "../services/DragonDiceAudioService";
import {
	registerCleanupCallback,
	registerSprite,
	unregisterSprite,
} from "../state";
import { useDragonDiceGameStore } from "../store/dragonDiceGameStore";

// ─── Bounce pre-computation ─────────────────────────────────────────────

interface BounceArc {
	start: number; // ms offset from bounce phase start
	dur: number; // ms duration of this arc
	peak: number; // px height at apex
}

function precomputeBounces(
	firstPeak: number,
	firstDur: number,
	restitution: number,
): { arcs: BounceArc[]; totalTime: number } {
	const arcs: BounceArc[] = [];
	let t = 0;
	let peak = firstPeak;
	let dur = firstDur;
	while (peak > 2 && arcs.length < 9) {
		arcs.push({ start: t, dur, peak });
		t += dur;
		peak *= restitution;
		dur *= Math.sqrt(restitution);
	}
	return { arcs, totalTime: t };
}

/** Returns Y offset (negative = up) and current arc info */
function sampleBounce(
	t: number,
	arcs: BounceArc[],
): { y: number; arcIdx: number; peak: number; normInArc: number } {
	for (let i = 0; i < arcs.length; i++) {
		const a = arcs[i];
		if (t >= a.start && t < a.start + a.dur) {
			const norm = (t - a.start) / a.dur;
			// Parabolic arc: 0 at ground, peaks at -peak, returns to 0
			const y = -a.peak * 4 * norm * (1 - norm);
			return { y, arcIdx: i, peak: a.peak, normInArc: norm };
		}
	}
	return { y: 0, arcIdx: arcs.length, peak: 0, normInArc: 0 };
}

// ─── Per-die state ──────────────────────────────────────────────────────

interface DieState {
	// Pre-computed (immutable after spawn)
	bounceArcs: BounceArc[];
	bounceEndTime: number;
	throwDur: number;
	throwArcHeight: number;
	spinSpeed: number; // base deg/ms
	spinDir: number; // 1 or -1
	tumbleFreq: number; // base scaleX oscillation freq
	settleDur: number;
	settleAngleAmp: number; // initial wobble degrees
	settleFreq: number; // wobble oscillation freq

	// Runtime (mutated each frame)
	accAngle: number;
	accTumble: number;
	faceIndex: number;
	flippedX: boolean;
	lastBounceIdx: number;
	lastFaceChangeTime: number;
	lastElapsed: number;
	lastAngle: number;
}

function rand(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

function createDieState(): DieState {
	const firstPeak = rand(55, 72);
	const firstDur = rand(420, 540);
	const restitution = rand(0.62, 0.72);
	const { arcs, totalTime } = precomputeBounces(
		firstPeak,
		firstDur,
		restitution,
	);

	return {
		bounceArcs: arcs,
		bounceEndTime: totalTime,
		throwDur: rand(200, 280),
		throwArcHeight: rand(40, 60),
		spinSpeed: rand(0.3, 0.5),
		spinDir: Math.random() > 0.5 ? 1 : -1,
		tumbleFreq: rand(0.018, 0.028),
		settleDur: rand(450, 650),
		settleAngleAmp: rand(6, 12),
		settleFreq: rand(0.016, 0.024),

		accAngle: 0,
		accTumble: rand(0, Math.PI * 2),
		faceIndex: Math.floor(Math.random() * DICE_FACE_COUNT) + 1,
		flippedX: false,
		lastBounceIdx: -1,
		lastFaceChangeTime: 0,
		lastElapsed: 0,
		lastAngle: 0,
	};
}

/** Smooth tint lerp: dark at edge-on, bright face-on */
function lerpTint(t: number): number {
	const lo = 0x66;
	const hi = 0xff;
	const v = Math.round(lo + (hi - lo) * Math.min(Math.max(t, 0), 1));
	return (v << 16) | (v << 8) | v;
}

// ─── System ─────────────────────────────────────────────────────────────

export function createDiceRollRenderSystem() {
	const diceSprites: Map<string, [ISprite, ISprite]> = new Map();
	const diceState: Map<string, [DieState, DieState]> = new Map();
	const diceAnchors: Map<
		string,
		UIAnchorHandle<ScreenAnchorOptions>
	> = new Map();
	/** Tracks wagers that have already triggered roll-start camera FX. */
	const fxRollStarted = new Set<string>();
	/** Tracks wagers that have already triggered landing camera FX. */
	const fxLanded = new Set<string>();
	let cleanupRegistered = false;

	return (world: PluginWorld, ctx: PluginSystemContext) => {
		const render = ctx.services.render;

		if (!cleanupRegistered) {
			registerCleanupCallback(() => {
				for (const [, sprites] of diceSprites) {
					sprites.forEach((s) => {
						unregisterSprite(s);
						s.destroy();
					});
				}
				for (const [, anchor] of diceAnchors) {
					anchor.release();
				}
				diceSprites.clear();
				diceState.clear();
				diceAnchors.clear();
			});
			cleanupRegistered = true;
		}

		const store = useDragonDiceGameStore.getState();
		const activeWagerIds = new Set<string>();
		const scale = DRAGON_DICE_SCALES.DICE;

		for (const [wagerId, roll] of store.diceRolls) {
			activeWagerIds.add(wagerId);

			let sprites = diceSprites.get(wagerId);

			if (!sprites) {
				if (!render.hasTexture(`${DICE_TEXTURE_PREFIX}1`)) continue;

				const d1 = render.createSprite(0, 0, `${DICE_TEXTURE_PREFIX}1`);
				const d2 = render.createSprite(0, 0, `${DICE_TEXTURE_PREFIX}1`);
				// scrollFactor(0,0) = screen-space rendering, unaffected by camera scroll/zoom.
				// Positioned via createScreenAnchor which provides screen pixel coordinates.
				[d1, d2].forEach((s) => {
					s.setScrollFactor(0, 0);
					s.setScale(scale);
					s.setOrigin(0.5, 0.5);
					s.setDepth(DRAGON_DICE_DEPTHS.DICE_ROLL);
					registerSprite(s);
				});

				sprites = [d1, d2];
				diceSprites.set(wagerId, sprites);
				diceState.set(wagerId, [createDieState(), createDieState()]);

				// Camera FX: shake on dice roll start
				if (!fxRollStarted.has(wagerId)) {
					fxRollStarted.add(wagerId);
					ctx.services.cameraController.shake({
						intensity: 3,
						durationMs: 500,
						decay: "exponential",
					});
				}
			}

			// Create screen anchor once per wager (fixed screen position)
			if (!diceAnchors.has(wagerId)) {
				diceAnchors.set(
					wagerId,
					ctx.services.ui.createScreenAnchor({
						anchor: "top-center",
						offsetY: 330,
					}),
				);
			}

			const elapsed = Date.now() - roll.startTime;
			const anchor = diceAnchors.get(wagerId);
			if (!anchor) continue;
			const screenPos = anchor.getPosition();
			const diceSpacing = 42;
			const sides = [-1, 1] as const;
			const states = diceState.get(wagerId);
			if (!states) continue;

			if (roll.state === "rolling") {
				const rollDur = DRAGON_DICE_ANIMATION.DICE_ROLL_DURATION;
				const rollProgress = Math.min(elapsed / rollDur, 1);
				const speedDecay = (1 - rollProgress) ** 1.8;

				for (let i = 0; i < 2; i++) {
					const die = states[i];
					const sprite = sprites[i];
					const side = sides[i];

					const dt = Math.min(elapsed - die.lastElapsed, 50);
					die.lastElapsed = elapsed;

					// Phase boundaries for this die
					const throwEnd = die.throwDur;
					const bounceStart = throwEnd;
					const bounceEnd = throwEnd + die.bounceEndTime;
					const settleEnd = bounceEnd + die.settleDur;

					// ── Accumulate spin + tumble ────────────────────
					die.accAngle += die.spinSpeed * die.spinDir * dt * speedDecay;
					const tumbleSpeed = die.tumbleFreq * (0.25 + speedDecay * 0.75);
					die.accTumble += tumbleSpeed * dt;

					// ── Tumble: scaleX oscillation + flip + face swap
					let scaleX = 1;
					const inActivePhase = elapsed < settleEnd;

					if (inActivePhase) {
						const rawSin = Math.sin(die.accTumble);
						scaleX = Math.max(0.05, Math.abs(rawSin));

						// Face change on zero-crossing (flip)
						const shouldFlip = rawSin >= 0;
						if (shouldFlip !== die.flippedX) {
							die.flippedX = shouldFlip;
							die.faceIndex = (die.faceIndex % DICE_FACE_COUNT) + 1;
							sprite.setTexture(`${DICE_TEXTURE_PREFIX}${die.faceIndex}`);
							die.lastFaceChangeTime = elapsed;
						}
						sprite.setFlipX(die.flippedX);
					} else {
						sprite.setFlipX(false);
					}

					// Timer-based face cycling (readable early, slow late)
					if (elapsed < settleEnd - 100) {
						const interval = 130 + (1 - speedDecay) * 450;
						if (elapsed - die.lastFaceChangeTime > interval) {
							die.faceIndex = (die.faceIndex % DICE_FACE_COUNT) + 1;
							sprite.setTexture(`${DICE_TEXTURE_PREFIX}${die.faceIndex}`);
							die.lastFaceChangeTime = elapsed;
						}
					}

					// ── Position + squash per phase ─────────────────
					let x = screenPos.x + side * diceSpacing;
					let y = screenPos.y;
					let squashY = 1;
					let stretchX = 1;
					let angle = die.accAngle;

					if (elapsed < throwEnd) {
						// THROW: parabolic arc from center outward
						const t = elapsed / throwEnd;
						const easeX = 1 - (1 - t) ** 3;
						x = screenPos.x + side * diceSpacing * easeX;
						// Arc up then down
						y = screenPos.y - die.throwArcHeight * 4 * t * (1 - t);
					} else if (elapsed < bounceEnd) {
						// BOUNCE: discrete parabolic arcs
						const bt = elapsed - bounceStart;
						const b = sampleBounce(bt, die.bounceArcs);
						y = screenPos.y + b.y;

						// Face change at each new impact
						if (b.arcIdx > die.lastBounceIdx) {
							die.lastBounceIdx = b.arcIdx;
							die.faceIndex = (die.faceIndex % DICE_FACE_COUNT) + 1;
							sprite.setTexture(`${DICE_TEXTURE_PREFIX}${die.faceIndex}`);
							die.lastFaceChangeTime = elapsed;
						}

						// Squash near ground, proportional to bounce energy
						if (b.peak > 0) {
							const hRatio = Math.abs(b.y) / b.peak;
							const groundF = (1 - hRatio) ** 3;
							const intensity = groundF * 0.3 * Math.min(b.peak / 30, 1);
							squashY = 1 - intensity;
							stretchX = 1 + intensity * 0.5;
						}

						// Tiny drift
						x += Math.sin(bt / 400) * 2 * die.spinDir;
					} else if (elapsed < settleEnd) {
						// SETTLE: damped wobble
						const st = (elapsed - bounceEnd) / die.settleDur;
						const damp = (1 - st) ** 2.5;

						angle =
							die.settleAngleAmp *
							Math.sin(st * die.settleFreq * die.settleDur) *
							damp;
						scaleX =
							1 -
							0.06 *
								Math.abs(Math.sin(st * die.settleFreq * die.settleDur * 1.3)) *
								damp;
					} else {
						// IDLE: subtle breathing
						const idleT = (elapsed - settleEnd) / 1000;
						const breathe = 1 + 0.01 * Math.sin(idleT * 2.5);
						scaleX = breathe;
						angle = 0;
					}

					// Wobble jitter during throw + bounce
					if (elapsed < bounceEnd) {
						const wobbleAmp = 7 * speedDecay;
						angle += Math.sin(elapsed * 0.11) * wobbleAmp;
					}

					die.lastAngle = angle;

					// ── Apply transforms ────────────────────────────
					sprite.setPosition(x, y);
					sprite.setAngle(angle);
					sprite.setScale(scale * scaleX * stretchX, scale * squashY);
					sprite.setTint(lerpTint(Math.min(scaleX / 0.5, 1)));
					sprite.setAlpha(1);
				}

				if (
					elapsed > DRAGON_DICE_ANIMATION.DICE_ROLL_DURATION &&
					roll.result !== null
				) {
					store.landDice(wagerId, roll.result);
				}
			} else if (roll.state === "landing") {
				const settleT = Math.min(elapsed / 300, 1);
				// Elastic ease-out
				const ease =
					settleT < 1
						? 1 -
							2 ** (-10 * settleT) *
								Math.cos((settleT * 10 - 0.75) * ((2 * Math.PI) / 3))
						: 1;

				for (let i = 0; i < 2; i++) {
					const die = states[i];
					const sprite = sprites[i];
					const side = sides[i];

					sprite.setAngle(die.lastAngle * (1 - ease));
					const pop = scale * (1 + 0.2 * (1 - ease));
					sprite.setScale(pop, pop);
					sprite.setFlipX(false);
					sprite.setTint(0xffffff);
					sprite.setAlpha(1);

					if (roll.result !== null) {
						const [f1, f2] = getHighLowDicePair(roll.result);
						sprite.setTexture(`${DICE_TEXTURE_PREFIX}${i === 0 ? f1 : f2}`);
					}

					sprite.setPosition(screenPos.x + side * diceSpacing, screenPos.y);
				}

				if (settleT >= 1) {
					playLandSound();

					// Camera FX: flash + shake on dice landing
					if (!fxLanded.has(wagerId)) {
						fxLanded.add(wagerId);
						ctx.services.cameraController.flash({
							color: 0xffffff,
							alpha: 0.5,
							durationMs: 150,
						});
						ctx.services.cameraController.shake({
							intensity: 2,
							durationMs: 200,
						});
					}

					const newRolls = new Map(store.diceRolls);
					const r = newRolls.get(wagerId);
					if (r) {
						newRolls.set(wagerId, {
							...r,
							state: "showing",
							startTime: Date.now(),
						});
						useDragonDiceGameStore.setState({
							diceRolls: newRolls,
						});
					}
				}
			} else if (roll.state === "showing") {
				for (let i = 0; i < 2; i++) {
					const sprite = sprites[i];
					const side = sides[i];

					sprite.setAngle(0);
					sprite.setScale(scale, scale);
					sprite.setFlipX(false);
					sprite.setTint(0xffffff);
					sprite.setPosition(screenPos.x + side * diceSpacing, screenPos.y);

					if (roll.result !== null) {
						const [f1, f2] = getHighLowDicePair(roll.result);
						sprite.setTexture(`${DICE_TEXTURE_PREFIX}${i === 0 ? f1 : f2}`);
					}
				}

				if (elapsed > DRAGON_DICE_ANIMATION.DICE_LAND_PAUSE) {
					const fadeT =
						(elapsed - DRAGON_DICE_ANIMATION.DICE_LAND_PAUSE) /
						DRAGON_DICE_ANIMATION.FADE_OUT_DURATION;
					const alpha = 1 - Math.min(fadeT, 1);
					sprites[0].setAlpha(alpha);
					sprites[1].setAlpha(alpha);

					if (fadeT >= 1) {
						store.completeDiceRoll(wagerId);
					}
				}
			}

			sprites[0].setVisible(true);
			sprites[1].setVisible(true);
		}

		// Cleanup sprites and anchors for completed rolls
		for (const [wagerId, sprs] of diceSprites) {
			if (!activeWagerIds.has(wagerId)) {
				sprs.forEach((s) => {
					unregisterSprite(s);
					s.destroy();
				});
				diceSprites.delete(wagerId);
				diceState.delete(wagerId);
				fxRollStarted.delete(wagerId);
				fxLanded.delete(wagerId);
				const anchor = diceAnchors.get(wagerId);
				if (anchor) {
					anchor.release();
					diceAnchors.delete(wagerId);
				}
			}
		}

		return world;
	};
}
