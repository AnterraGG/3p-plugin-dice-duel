/**
 * SvmLeaderboardContent — Global Dice Duel leaderboard.
 *
 * Displays top players sorted by wins (desc).
 * Columns: rank, player, wins, SOL wagered, current streak, games played.
 * Highlights the current player's row if they appear on the board.
 */

import { usePluginSvmTransaction } from "@townexchange/3p-plugin-sdk/client";
import { GameWindow, Typography } from "@townexchange/tex-ui-kit";
import { useSvmGlobalLeaderboard } from "../../../hooks/svm/queries-indexed";
import styles from "./SvmLeaderboard.module.scss";

interface Props {
	onClose: () => void;
}

function formatSol(lamports: string): string {
	const sol = Number(lamports) / 1e9;
	if (sol === 0) return "0";
	if (sol < 0.01) return "<0.01";
	return sol.toFixed(2);
}

export default function SvmLeaderboardContent({ onClose }: Props) {
	const { walletAddress } = usePluginSvmTransaction();
	const { data, isLoading, isError } = useSvmGlobalLeaderboard(20);
	const players = data?.leaderboard ?? [];

	return (
		<GameWindow
			id="dice-duel:leaderboard"
			title="Dice Duel — Leaderboard"
			size="md"
			isOpen
			onClose={onClose}
			overlay={false}
			modal={false}
			draggable
			escapable
			position={{ x: "5%", y: "10%" }}
		>
			{isError ? (
				<div className={styles.emptyState}>
					<Typography size="sm" variant="muted">
						Failed to load leaderboard. Try again later.
					</Typography>
				</div>
			) : isLoading ? (
				<div className={styles.emptyState}>
					<Typography size="sm" variant="muted">
						Loading leaderboard...
					</Typography>
				</div>
			) : players.length === 0 ? (
				<div className={styles.emptyState}>
					<Typography size="sm" variant="muted">
						No games played yet. Be the first!
					</Typography>
				</div>
			) : (
				<div className={styles.tableWrapper}>
					<table className={styles.table}>
						<thead>
							<tr>
								<th className={styles.rank}>#</th>
								<th>Player</th>
								<th className={styles.numCol}>Wins</th>
								<th className={styles.numCol}>SOL Wagered</th>
								<th className={styles.numCol}>Streak</th>
								<th className={styles.numCol}>Games</th>
							</tr>
						</thead>
						<tbody>
							{players.map((p, i) => {
								const isCurrentPlayer =
									!!walletAddress && p.player === walletAddress;
								return (
									<tr
										key={p.player}
										className={
											isCurrentPlayer ? styles.currentPlayer : undefined
										}
									>
										<td className={styles.rank}>{i + 1}</td>
										<td className={styles.player}>
											{p.player.slice(0, 4)}...{p.player.slice(-4)}
											{isCurrentPlayer && (
												<span className={styles.youBadge}>you</span>
											)}
										</td>
										<td className={`${styles.wins} ${styles.numCol}`}>
											{p.wins}
										</td>
										<td className={`${styles.sol} ${styles.numCol}`}>
											{formatSol(p.solWagered)}
										</td>
										<td className={`${styles.streak} ${styles.numCol}`}>
											{p.currentStreak}
										</td>
										<td className={`${styles.games} ${styles.numCol}`}>
											{p.totalGames}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</GameWindow>
	);
}
