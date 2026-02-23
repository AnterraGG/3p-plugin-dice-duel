/**
 * Dragon Dice Notification Store
 *
 * Pure Zustand store — no internal imports.
 */

import { create } from "zustand";

export type DragonDiceNotification =
	| {
			type: "dice_minted";
			diceId: number;
	  }
	| {
			type: "dice_bag_minted";
			mint: string;
			owner: string;
	  }
	| {
			type: "wager_received";
			wagerId: string;
			initiator: string;
			/** Opponent address (populated so initiator can display who they challenged) */
			opponent?: string;
			amount: string;
			token: string;
			/** SVM wager PDA address */
			wagerAddress?: string;
	  }
	| {
			type: "wager_accepted";
			wagerId: string;
			acceptor: string;
			wagerAddress?: string;
	  }
	| {
			type: "wager_ready_to_claim";
			wagerId: string;
			winner: string;
			diceTotal: number;
			wagerAmount?: string;
			wagerToken?: string;
			wagerAddress?: string;
	  }
	| {
			type: "wager_claimed";
			wagerId: string;
			winner: string;
			payout?: string;
			fee?: string;
			wagerAddress?: string;
	  }
	| {
			type: "wager_cancelled";
			wagerId: string;
			initiator: string;
			wagerAddress?: string;
	  }
	| {
			type: "wager_expired";
			wagerId: string;
			wagerAddress?: string;
	  }
	| {
			type: "wager_vrf_timeout";
			wagerId: string;
			wagerAddress?: string;
	  };

interface DragonDiceNotificationStore {
	notifications: DragonDiceNotification[];
	addNotification: (notification: DragonDiceNotification) => void;
	clearNotification: (index: number) => void;
	clearAllNotifications: () => void;
	reset: () => void;
}

const INITIAL_STATE = {
	notifications: [] as DragonDiceNotification[],
};

/** Generate a dedup key for a notification. Same wager+type = duplicate. */
function getNotificationKey(n: DragonDiceNotification): string {
	switch (n.type) {
		case "dice_minted":
			return `dice_minted:${n.diceId}`;
		case "dice_bag_minted":
			return `dice_bag_minted:${n.mint}`;
		default:
			return `${n.type}:${n.wagerId}`;
	}
}

// Track recently seen notifications to prevent duplicates from dual-path
// publishing (account-state-diff + anchor events) and NATS redelivery.
// 30s window tolerates the delay between the two publish paths.
const recentKeys = new Set<string>();
const DEDUP_WINDOW_MS = 30_000;

export const useDragonDiceNotificationStore =
	create<DragonDiceNotificationStore>((set) => ({
		...INITIAL_STATE,
		addNotification: (notification) => {
			const key = getNotificationKey(notification);
			if (recentKeys.has(key)) return; // duplicate — skip
			recentKeys.add(key);
			setTimeout(() => recentKeys.delete(key), DEDUP_WINDOW_MS);
			set((state) => ({
				notifications: [...state.notifications, notification],
			}));
		},
		clearNotification: (index) =>
			set((state) => ({
				notifications: state.notifications.filter((_, i) => i !== index),
			})),
		clearAllNotifications: () => set({ notifications: [] }),
		reset: () => set(INITIAL_STATE),
	}));
