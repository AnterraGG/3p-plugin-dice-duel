/**
 * AcceptWagerSvm — Accept or decline an incoming DiceDuel wager.
 *
 * Matches EVM IncomingWagerContent layout:
 * Timer, wager details (infoBox/infoRow), balance display,
 * status boxes, footer buttons.
 */

import type { Address } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import {
	usePluginAudio,
	usePluginIdentity,
} from "@townexchange/3p-plugin-sdk/client";
import {
	Button,
	Stack,
	StatusBox,
	Typography,
	modalStyles,
	notificationApi,
} from "@townexchange/tex-ui-kit";
import { useCallback, useState } from "react";
import type { SvmWager } from "../../../api";
import { logDiceDuelError } from "../../../hooks/svm/errors";
import { queryKeys } from "../../../hooks/svm/queries-indexed";
import { assets } from "../../../../shared/assets";
import { useDiceDuelSvm } from "../../../hooks/svm/useDiceDuelSvm";
import { useCountdown } from "../../../hooks/useCountdown";

type TxState = "idle" | "confirming" | "success" | "error";

const lamportsToSol = (l: string) => {
	const sol = Number(l) / 1e9;
	return sol < 0.001 ? "<0.001" : sol.toFixed(3);
};

interface AcceptWagerSvmProps {
	wager: SvmWager;
	onClose: () => void;
}

export const AcceptWagerSvm: React.FC<AcceptWagerSvmProps> = ({
	wager,
	onClose,
}) => {
	const audio = usePluginAudio();
	const queryClient = useQueryClient();
	const { acceptWager, isLoading } = useDiceDuelSvm();
	const { getUsernameBySvmAddress } = usePluginIdentity();
	const [txState, setTxState] = useState<TxState>("idle");
	const [errorMsg, setErrorMsg] = useState("");

	const handleAccept = useCallback(async () => {
		setTxState("confirming");
		audio.play(assets.audio.click, { volume: 0.6 });

		try {
			await acceptWager.execute({
				challenger: wager.challenger as Address,
				challengerBagPda: wager.challengerBag as Address,
				nonce: BigInt(wager.nonce),
			});

			setTxState("success");
			// No inline notification — server-driven wager_accepted event
			// in DiceDuelUIContainer handles the "Challenge Accepted!" toast.

			queryClient.invalidateQueries({
				queryKey: queryKeys.inventoryWagers.all(),
			});
			queryClient.invalidateQueries({ queryKey: queryKeys.diceBags.all() });

			setTimeout(onClose, 800);
		} catch (e: any) {
			const decoded = logDiceDuelError("acceptWager", e);
			setTxState("error");
			setErrorMsg(decoded.message);
			audio.play(assets.audio.lose, { volume: 0.6 });
			notificationApi.notify({
				type: "error",
				title: "Error",
				message: `Accept failed: ${decoded.message}`,
				channel: "dice-duel",
			});
			setTimeout(() => setTxState("idle"), 3000);
		}
	}, [acceptWager, wager, queryClient, onClose]);

	const busy = isLoading || txState === "confirming";
	const choiceLabel = wager.challengerChoice === 0 ? "Low" : "High";
	const yourChoice = choiceLabel === "High" ? "Low" : "High";
	const expiresAtNum = wager.expiresAt ? Number(wager.expiresAt) : null;
	const countdown = useCountdown(expiresAtNum);
	const isExpired =
		expiresAtNum != null && expiresAtNum > 0 && countdown === null;

	return (
		<Stack gap={4} style={{ padding: "1rem", minWidth: 300 }}>
			{/* Countdown Timer */}
			{countdown && (
				<div
					style={{
						textAlign: "center",
						padding: "6px 0",
						borderBottom: "1px solid rgba(255,255,255,0.08)",
					}}
				>
					<Typography variant="muted" size="xs" style={{ marginBottom: 2 }}>
						Time to accept
					</Typography>
					<Typography
						size="lg"
						style={{
							fontWeight: 700,
							fontVariantNumeric: "tabular-nums",
							color:
								expiresAtNum! - Math.floor(Date.now() / 1000) < 60
									? "#ef4444"
									: "#f59e0b",
						}}
					>
						⏱ {countdown}
					</Typography>
				</div>
			)}

			{/* Expired Warning */}
			{isExpired && (
				<StatusBox variant="error">
					<Typography variant="error" size="sm">
						This wager has expired and can no longer be accepted.
					</Typography>
				</StatusBox>
			)}

			{/* Wager Details */}
			<div className={modalStyles.infoBox}>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						Challenger
					</Typography>
					<Typography variant="light" size="sm">
						{getUsernameBySvmAddress(wager.challenger)}
					</Typography>
				</div>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						Their Wager
					</Typography>
					<Typography variant="light" size="sm">
						{lamportsToSol(wager.amount)} SOL
					</Typography>
				</div>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						You Must Match
					</Typography>
					<Typography variant="gold" size="sm">
						{lamportsToSol(wager.amount)} SOL
					</Typography>
				</div>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						Their Bet
					</Typography>
					<Typography variant="light" size="sm">
						{choiceLabel}
					</Typography>
				</div>
				<div className={modalStyles.infoRow}>
					<Typography variant="muted" size="xs">
						Your Bet If Accepted
					</Typography>
					<Typography variant="gold" size="sm">
						{yourChoice}
					</Typography>
				</div>
			</div>

			{/* Error */}
			{errorMsg && (
				<StatusBox variant="error">
					<Typography variant="error" size="sm">
						{errorMsg}
					</Typography>
				</StatusBox>
			)}

			{/* Success */}
			{txState === "success" && (
				<StatusBox variant="success">
					<Typography variant="success" size="sm">
						Wager accepted! Dice rolling...
					</Typography>
				</StatusBox>
			)}

			{/* Action Buttons */}
			<div className={modalStyles.footer}>
				<Button
					variant="secondary"
					width="full"
					onClick={onClose}
					disabled={busy}
				>
					Decline
				</Button>
				<Button
					variant="primary"
					width="full"
					onClick={handleAccept}
					disabled={busy || isExpired}
				>
					{isExpired
						? "Expired"
						: txState === "confirming"
							? "Accepting..."
							: "Accept Challenge"}
				</Button>
			</div>
		</Stack>
	);
};
