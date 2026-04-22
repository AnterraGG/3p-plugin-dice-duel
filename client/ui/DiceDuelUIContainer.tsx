/**
 * DiceDuelUIContainer - Zone-aware UI container for Dice Duel (3p SDK version)
 */

import {
	useActiveZones,
	usePluginAudio,
	usePluginIdentity,
	usePluginSvmTransaction,
} from "@anterra/3p-plugin-sdk/client";
import { usePluginActiveChain } from "@anterra/3p-plugin-sdk/client";
import { ZoneType } from "@anterra/3p-plugin-sdk/shared";
import {
	NotificationContainer,
	useNotification,
} from "@anterra/tex-ui-kit";
import { useEffect } from "react";
import { assets } from "../../shared/assets";
import { DICE_DUEL_ANIMATION } from "../../shared/constants";
import { formatTokenAmount, getTokenSymbol } from "../../shared/tokenUtils";
import { getLocalPlayerEntityId, getLocalPlayerPosition } from "../state";
import {
	useDiceDuelGameStore,
	useDiceDuelNotificationStore,
} from "../store";
import { SvmInventory } from "./svm/SvmInventory";

/**
 * Hook to handle Dice Duel notifications and show toast notifications.
 *
 * Chain-aware: uses the appropriate wallet address and query keys
 * depending on whether the active game chain is EVM or SVM.
 */
function useDiceDuelNotifications() {
	const audio = usePluginAudio();
	const notify = useNotification((s) => s.notify);
	const chain = usePluginActiveChain("svm");
	const { walletAddress: svmWalletAddress } = usePluginSvmTransaction();
	const { getUsernameBySvmAddress } = usePluginIdentity();

	/** Resolve a display name for any address — username if online, truncated address otherwise. */
	const getDisplayName = (address: string): string => {
		if (!address) return "Unknown";
		return getUsernameBySvmAddress(address);
	};
	const notifications = useDiceDuelNotificationStore((s) => s.notifications);
	const clearNotification = useDiceDuelNotificationStore(
		(s) => s.clearNotification,
	);

	const gameWalletAddress = svmWalletAddress;

	useEffect(() => {
		if (notifications.length === 0) return;

		const notification = notifications[0];
		if (!notification) return;

		const getEffectPosition = () => {
			const pos = getLocalPlayerPosition();
			return pos ?? { x: 0, y: 0 };
		};

		const gameStore = useDiceDuelGameStore.getState();

		const compareAddresses = (a: string, b: string): boolean => {
			return a === b;
		};

		switch (notification.type) {
			case "dice_minted":
				audio.play(assets.audio.coin, { volume: 0.6 });
				notify({
					type: "success",
					title: "Dice Minted!",
					message: `You received Dice #${notification.diceId}`,
					channel: "dice-duel",
				});
				break;

			case "dice_bag_minted":
				audio.play(assets.audio.coin, { volume: 0.6 });
				notify({
					type: "success",
					title: "Dice Bag Minted!",
					message: `Your new dice bag is ready (${notification.mint.slice(0, 4)}...${notification.mint.slice(-4)})`,
					channel: "dice-duel",
				});
				break;

			case "wager_received": {
				const isInitiator =
					notification.initiator &&
					gameWalletAddress &&
					compareAddresses(notification.initiator, gameWalletAddress);
				audio.play(assets.audio.challenge, { volume: 0.6 });
				if (isInitiator) {
					// Initiator confirmation — wager was created on-chain
					const opponentName = notification.opponent
						? getDisplayName(notification.opponent)
						: "opponent";
					const amt = notification.amount
						? `${(Number(notification.amount) / 1e9).toFixed(3)} ${notification.token || "SOL"}`
						: "";
					notify({
						type: "success",
						title: "Wager Sent!",
						message: amt
							? `Dice Duel challenge sent to ${opponentName} for ${amt}.`
							: `Dice Duel challenge sent to ${opponentName}.`,
						channel: "dice-duel",
					});
				} else {
					// Opponent — incoming challenge
					gameStore.addChallengeIndicator(
						notification.wagerId,
						notification.initiator,
					);
					notify({
						type: "info",
						title: "New Wager Challenge!",
						message: `${getDisplayName(notification.initiator)} challenged you to a wager!`,
						channel: "dice-duel",
					});
				}
				break;
			}

			case "wager_accepted": {
				gameStore.removeChallengeIndicator(notification.wagerId);
				audio.play(assets.audio.roll, { volume: 0.6 });
				const pos = getEffectPosition();
				gameStore.startDiceRoll(notification.wagerId, pos);
				const isAcceptor =
					notification.acceptor &&
					gameWalletAddress &&
					compareAddresses(notification.acceptor, gameWalletAddress);
				if (isAcceptor) {
					notify({
						type: "success",
						title: "Challenge Accepted!",
						message: "Dice are rolling!",
						channel: "dice-duel",
					});
				} else {
					notify({
						type: "success",
						title: "Wager Accepted!",
						message: `${getDisplayName(notification.acceptor)} accepted your challenge. Rolling dice!`,
						channel: "dice-duel",
					});
				}
				break;
			}

			case "wager_ready_to_claim": {
				const isWinner =
					notification.winner &&
					gameWalletAddress &&
					compareAddresses(notification.winner, gameWalletAddress);

				const pos = getEffectPosition();
				gameStore.removeChallengeIndicator(notification.wagerId);

				const existingRoll = gameStore.diceRolls.get(notification.wagerId);
				if (!existingRoll) {
					audio.play(assets.audio.roll, { volume: 0.6 });
					gameStore.startDiceRoll(notification.wagerId, pos);
				}

				// Store result on the roll — the render system will land
				// the dice after DICE_ROLL_DURATION has elapsed.
				gameStore.setDiceResult(notification.wagerId, notification.diceTotal);

				// Celebration timing: DICE_ROLL_DURATION (rolling) + 300ms (landing settle)
				// + DICE_LAND_PAUSE (showing) + CELEBRATION_DELAY
				const rollTimeRemaining = existingRoll
					? Math.max(
							0,
							DICE_DUEL_ANIMATION.DICE_ROLL_DURATION -
								(Date.now() - existingRoll.startTime),
						)
					: DICE_DUEL_ANIMATION.DICE_ROLL_DURATION;
				const celebrationDelay =
					rollTimeRemaining +
					300 + // landing animation
					DICE_DUEL_ANIMATION.CELEBRATION_DELAY;

				setTimeout(() => {
					if (isWinner) {
						audio.play(assets.audio.win, { volume: 0.6 });
					} else {
						audio.play(assets.audio.lose, { volume: 0.6 });
					}
					gameStore.addCelebration(
						isWinner ? "win" : "lose",
						pos,
						getLocalPlayerEntityId() ?? undefined,
					);
				}, celebrationDelay);

				// Balance float appears shortly after celebration
				if (notification.wagerAmount && notification.wagerToken) {
					setTimeout(() => {
						const formattedAmount = formatTokenAmount(
							BigInt(notification.wagerAmount!),
							notification.wagerToken!,
						);
						const symbol = getTokenSymbol(notification.wagerToken!);
						gameStore.addBalanceFloat(
							formattedAmount,
							symbol,
							!!isWinner,
							pos,
							undefined,
							getLocalPlayerEntityId() ?? undefined,
						);
					}, celebrationDelay + 600);
				}

				// Format amount for notification message
				let resultMsg: string;
				if (notification.wagerAmount && notification.wagerToken) {
					const amt = formatTokenAmount(
						BigInt(notification.wagerAmount),
						notification.wagerToken,
					);
					const sym = getTokenSymbol(notification.wagerToken);
					resultMsg = isWinner
						? `You rolled ${notification.diceTotal}! You won ${amt} ${sym} — claim your prize!`
						: `You rolled ${notification.diceTotal}. You lost ${amt} ${sym}. Better luck next time!`;
				} else {
					resultMsg = isWinner
						? `You rolled ${notification.diceTotal}! You won — claim your prize!`
						: `You rolled ${notification.diceTotal}. Better luck next time!`;
				}

				notify({
					type: isWinner ? "success" : "info",
					title: isWinner ? "You Won!" : "You Lost",
					message: resultMsg,
					channel: "dice-duel",
				});
				break;
			}

			case "wager_claimed": {
				// Show a notification with the payout amount
				if (notification.payout) {
					const payoutSol = (Number(notification.payout) / 1e9).toFixed(3);
					audio.play(assets.audio.coin, { volume: 0.6 });
					notify({
						type: "success",
						title: "Winnings Claimed!",
						message: `+${payoutSol} SOL sent to your wallet.`,
						channel: "dice-duel",
					});
				}
				break;
			}

			case "wager_cancelled":
				gameStore.removeChallengeIndicator(notification.wagerId);
				audio.play(assets.audio.coin, { volume: 0.6 });
				notify({
					type: "info",
					title: "Wager Cancelled",
					message:
						notification.initiator &&
						gameWalletAddress &&
						compareAddresses(notification.initiator, gameWalletAddress)
							? "Your wager has been cancelled. Funds have been refunded."
							: `${getDisplayName(notification.initiator)} cancelled their wager.`,
					channel: "dice-duel",
				});
				break;

			case "wager_expired":
				gameStore.removeChallengeIndicator(notification.wagerId);
				notify({
					type: "info",
					title: "Wager Expired",
					message:
						"A wager expired without being accepted. Funds have been refunded.",
					channel: "dice-duel",
				});
				break;

			case "wager_vrf_timeout":
				notify({
					type: "warning",
					title: "VRF Timeout",
					message: "The dice roll timed out. Both players have been refunded.",
					channel: "dice-duel",
				});
				break;
		}

		clearNotification(0);
	}, [
		audio,
		notifications,
		notify,
		clearNotification,
		gameWalletAddress,
		getDisplayName,
		chain,
	]);
}

/**
 * Main UI for Dice Duel game mode.
 */
function DiceDuelUI() {
	useDiceDuelNotifications();

	return (
		<div
			className="dice-duel-ui"
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				pointerEvents: "none",
				zIndex: 100,
			}}
		>
			<NotificationContainer position="top-center" channel="dice-duel" />

			<div
				style={{
					position: "absolute",
					top: "80px",
					right: "16px",
					pointerEvents: "auto",
					maxHeight: "calc(100vh - 160px)",
					overflowY: "auto",
				}}
			>
				<SvmInventory />
			</div>
		</div>
	);
}

/**
 * Container that checks zone activation before rendering.
 */
export function DiceDuelUIContainer() {
	const activeZones = useActiveZones();
	const isInDiceDuelZone = activeZones.has(ZoneType.DragonDice);

	if (!isInDiceDuelZone) return null;

	return <DiceDuelUI />;
}
