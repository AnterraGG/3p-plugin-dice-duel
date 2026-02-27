/**
 * Dice Duel Server Plugin (3p SDK version)
 *
 * Handles onchain events from the SVM indexer and routes
 * notifications to the appropriate connected players.
 */

import {
	defineEventHandlers,
	defineServerPlugin,
} from "@townexchange/3p-plugin-sdk/server";
import type { OnchainEvent } from "@townexchange/3p-plugin-sdk/shared";
import { PluginAnimationType } from "@townexchange/3p-plugin-sdk/shared";
import { formatSol } from "@townexchange/3p-plugin-sdk/shared";
import type {
	DiceDuelEventMap,
	WagerStatusEventData,
} from "../shared/event-data";
import { manifest } from "../shared/manifest";
import {
	DiceBagNotification,
	WagerNotification,
	type WagerNotificationData,
} from "../shared/messages";

// ─── Plugin Definition ──────────────────────────────────────────────────────

export const diceDuelServerPlugin = defineServerPlugin({
	id: manifest.id,
	name: manifest.name,
	outboundMessages: [WagerNotification, DiceBagNotification],

	onchainEvents(ctx) {
		const log = ctx.logger;

		// ─── Helpers ──────────────────────────────────────────────────

		/** Resolve SVM address → playerId (undefined if offline). */
		function pid(address: string | undefined): number | undefined {
			if (!address) return undefined;
			return ctx.onchain.wallets.getPlayerIdBySvmAddress(address);
		}

		/** Format a playerId as a template token: {player:123} */
		function p(playerId: number | undefined): string {
			return playerId !== undefined ? `{player:${playerId}}` : "opponent";
		}

		/** Format a SOL amount as a template token: {sol:0.01} */
		function sol(lamports: string): string {
			return `{sol:${formatSol(lamports)}}`;
		}

		function notifyWager(address: string, data: WagerNotificationData): void {
			const sent = ctx.outbound.send({
				target: { type: "svmAddress", address },
				message: WagerNotification,
				data,
			});
			if (!sent) {
				log.warn(
					`Could not reach ${address.slice(0, 8)}... for ${data.notificationType}`,
				);
			}
		}

		function notifyBoth(
			challenger: string,
			opponent: string | undefined,
			data: WagerNotificationData,
		): void {
			notifyWager(challenger, data);
			if (opponent) notifyWager(opponent, data);
		}

		/** Resolve SVM addresses to playerIds and send a chat message. */
		function chatToPlayers(
			addresses: (string | undefined)[],
			message: string,
			subType: "invite" | "result" | "info",
		): void {
			const playerIds: number[] = [];
			for (const addr of addresses) {
				if (!addr) continue;
				const id = pid(addr);
				if (id !== undefined) playerIds.push(id);
			}
			if (playerIds.length > 0) {
				ctx.chat.sendToPlayers({ playerIds, message, subType });
			}
		}

		/** Factory for simple wager status events that notify both parties. */
		function wagerStatusHandler(notificationType: string, chatMessage: string) {
			return (event: OnchainEvent<WagerStatusEventData>) => {
				const { challenger, opponent, wagerAddress } = event.data;
				log.info(
					`${notificationType}: challenger=${challenger.slice(0, 8)}... opponent=${opponent?.slice(0, 8) ?? "none"}... wager=${wagerAddress}`,
				);
				notifyBoth(challenger, opponent, {
					notificationType,
					wagerId: wagerAddress,
					initiator: challenger,
					acceptor: opponent,
					wagerAddress,
				});
				chatToPlayers([challenger, opponent], chatMessage, "info");
			};
		}

		// ─── Event Handlers ───────────────────────────────────────────

		return defineEventHandlers<DiceDuelEventMap>({
			wager_initiated(event) {
				const { challenger, opponent, amount, wagerAddress } = event.data;
				if (!challenger || !opponent) return;
				log.info(
					`wager_initiated: challenger=${challenger.slice(0, 8)}... opponent=${opponent.slice(0, 8)}...`,
				);
				notifyBoth(challenger, opponent, {
					notificationType: "wager_received",
					wagerId: wagerAddress,
					initiator: challenger,
					acceptor: opponent,
					amount,
					token: "SOL",
					wagerAddress,
				});

				// Chat: personalized invite messages
				const cPid = pid(challenger);
				const oPid = pid(opponent);
				const s = sol(amount);
				const msgs: Array<{
					playerId: number;
					message: string;
					subType: "invite" | "result" | "info";
				}> = [];
				if (cPid !== undefined)
					msgs.push({
						playerId: cPid,
						message: `You challenged ${p(oPid)} to a ${s} dice duel!`,
						subType: "invite",
					});
				if (oPid !== undefined)
					msgs.push({
						playerId: oPid,
						message: `${p(cPid)} challenged you to a ${s} dice duel!`,
						subType: "invite",
					});
				if (msgs.length > 0) ctx.chat.sendPersonalized(msgs);
			},

			wager_accepted(event) {
				const { challenger, opponent, wagerAddress } = event.data;
				if (!challenger || !opponent) return;
				log.info(
					`wager_accepted: challenger=${challenger.slice(0, 8)}... opponent=${opponent?.slice(0, 8)}...`,
				);
				notifyBoth(challenger, opponent, {
					notificationType: "wager_accepted",
					wagerId: wagerAddress,
					initiator: challenger,
					acceptor: opponent,
					wagerAddress,
				});
				ctx.players.playAnimation(
					{ svmAddress: challenger },
					PluginAnimationType.Dice,
					{ durationMs: 3000, blocksMovement: true },
				);

				// Chat
				const cPid = pid(challenger);
				const oPid = pid(opponent);
				chatToPlayers(
					[challenger, opponent],
					`${p(cPid)} vs ${p(oPid)} — dice rolling!`,
					"info",
				);
			},

			wager_cancelled(event) {
				const { challenger, opponent, wagerAddress } = event.data;
				log.info(
					`wager_cancelled: challenger=${challenger.slice(0, 8)}... opponent=${opponent ? `${opponent.slice(0, 8)}...` : "none"}`,
				);
				notifyBoth(challenger, opponent, {
					notificationType: "wager_cancelled",
					wagerId: wagerAddress,
					initiator: challenger,
					wagerAddress,
				});

				// Chat
				chatToPlayers([challenger, opponent], "Dice duel cancelled.", "info");
			},

			wager_resolved(event) {
				const d = event.data;
				log.info(
					`wager_resolved: winner=${d.winner.slice(0, 8)}... vrfResult=${d.vrfResult} wager=${d.wagerAddress}`,
				);
				notifyBoth(d.challenger, d.opponent, {
					notificationType: "wager_ready_to_claim",
					wagerId: d.wagerAddress,
					winner: d.winner,
					diceTotal: d.vrfResult,
					wagerAmount: d.amount,
					wagerToken: "SOL",
					initiator: d.challenger,
					acceptor: d.opponent,
					wagerAddress: d.wagerAddress,
				});

				// Chat: personalized win/loss messages
				const loser = d.winner === d.challenger ? d.opponent : d.challenger;
				const winPid = pid(d.winner);
				const losePid = pid(loser);
				const msgs: Array<{
					playerId: number;
					message: string;
					subType: "invite" | "result" | "info";
				}> = [];
				if (winPid !== undefined)
					msgs.push({
						playerId: winPid,
						message: `You won against ${p(losePid)}! Rolled ${d.vrfResult}.`,
						subType: "result",
					});
				if (losePid !== undefined)
					msgs.push({
						playerId: losePid,
						message: `You lost to ${p(winPid)}. Rolled ${d.vrfResult}.`,
						subType: "result",
					});
				if (msgs.length > 0) ctx.chat.sendPersonalized(msgs);
			},

			winnings_claimed(event) {
				const d = event.data;
				log.info(
					`winnings_claimed: winner=${d.winner.slice(0, 8)}... payout=${d.payout ?? "n/a"} fee=${d.fee ?? "n/a"} wager=${d.wagerAddress ?? "unknown"}`,
				);
				notifyWager(d.winner, {
					notificationType: "wager_claimed",
					wagerId: d.wagerAddress ?? d.winner,
					winner: d.winner,
					wagerAmount: d.amount,
					wagerToken: "SOL",
					initiator: d.challenger,
					acceptor: d.opponent,
					wagerAddress: d.wagerAddress,
					payout: d.payout,
					fee: d.fee,
				});

				// Chat
				chatToPlayers(
					[d.winner],
					`Winnings claimed! +${sol(d.payout ?? d.amount)}`,
					"result",
				);
			},

			// Simple status events — identical shape, different notificationType
			wager_expired: wagerStatusHandler("wager_expired", "Dice duel expired."),
			vrf_timeout_claimed: wagerStatusHandler(
				"wager_vrf_timeout",
				"VRF timed out. Wager refunded.",
			),

			// ── Dice Bag events ──
			dice_bag_minted(event) {
				const { player, mint } = event.data;
				log.info(
					`dice_bag_minted: player=${player.slice(0, 8)}... mint=${mint.slice(0, 8)}...`,
				);
				ctx.outbound.send({
					target: { type: "svmAddress", address: player },
					message: DiceBagNotification,
					data: { notificationType: "dice_bag_minted", mint, owner: player },
				});
			},

			dice_bag_updated(event) {
				const { player, mint, usesRemaining } = event.data;
				log.info(
					`dice_bag_updated: player=${player.slice(0, 8)}... mint=${mint.slice(0, 8)}... uses=${usesRemaining}`,
				);
				ctx.outbound.send({
					target: { type: "svmAddress", address: player },
					message: DiceBagNotification,
					data: {
						notificationType: "dice_bag_updated",
						mint,
						owner: player,
						usesRemaining,
					},
				});
			},
		});
	},
});
