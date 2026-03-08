/**
 * InitiateWagerSvm — Form to create a new DiceDuel wager challenge.
 *
 * The dice bag is pre-selected from the inventory — no dropdown.
 * Opponent info, dice display, amount input, position picker,
 * transaction summary, status boxes, footer buttons.
 */

import type { Address } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import {
	Button,
	Flex,
	PositionPicker,
	Stack,
	StatusBox,
	TextInput,
	TransactionInfoBox,
	Typography,
	modalStyles,
	notificationApi,
} from "@townexchange/tex-ui-kit";
import { usePluginAudio } from "@townexchange/3p-plugin-sdk/client";
import { useCallback, useMemo, useState } from "react";
import { assets } from "../../../../shared/assets";
import { logDiceDuelError } from "../../../hooks/svm/errors";
import { queryKeys, useSvmDiceBags } from "../../../hooks/svm/queries-indexed";
import { useDiceDuelSvm } from "../../../hooks/svm/useDiceDuelSvm";

type TxState = "idle" | "confirming" | "success" | "error";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PRESET_AMOUNTS = ["0.01", "0.05", "0.1", "0.25"];

const truncAddr = (a: string) =>
	a ? `${a.slice(0, 4)}...${a.slice(-4)}` : "???";

interface InitiateWagerSvmProps {
	defaultOpponent?: string;
	opponentName?: string;
	/** Mint address of the dice bag selected from inventory */
	diceBagMint?: string;
	onClose?: () => void;
}

export const InitiateWagerSvm: React.FC<InitiateWagerSvmProps> = ({
	defaultOpponent = "",
	opponentName,
	diceBagMint,
	onClose,
}) => {
	const audio = usePluginAudio();
	const queryClient = useQueryClient();
	const { initiateWager, isLoading, walletAddress } = useDiceDuelSvm();
	const { data: diceBagsData } = useSvmDiceBags();

	const [opponent, setOpponent] = useState(defaultOpponent);
	const [amount, setAmount] = useState("0.05");
	const [choice, setChoice] = useState<0 | 1>(1); // 0 = Low, 1 = High
	const [txState, setTxState] = useState<TxState>("idle");
	const [errorMsg, setErrorMsg] = useState("");

	// Resolve the selected dice bag from the mint passed via inventory selection
	const selectedDice = useMemo(() => {
		if (!diceBagMint || !diceBagsData?.diceBags) return null;
		return diceBagsData.diceBags.find((b) => b.mint === diceBagMint) ?? null;
	}, [diceBagMint, diceBagsData]);

	const validate = useCallback((): string | null => {
		if (!opponent.trim()) return "Enter opponent address";
		if (!BASE58_RE.test(opponent.trim())) return "Invalid Solana address";
		if (opponent.trim() === walletAddress) return "Cannot challenge yourself";
		const sol = Number.parseFloat(amount);
		if (Number.isNaN(sol) || sol <= 0) return "Amount must be > 0";
		if (!diceBagMint) return "No dice bag selected";
		if (!selectedDice) return "Selected dice bag not found";
		if (selectedDice.usesRemaining <= 0)
			return "Selected dice bag has no uses remaining";
		return null;
	}, [opponent, amount, diceBagMint, selectedDice, walletAddress]);

	const handleSubmit = useCallback(async () => {
		const err = validate();
		if (err) {
			setErrorMsg(err);
			audio.play(assets.audio.lose, { volume: 0.6 });
			return;
		}
		setErrorMsg("");
		setTxState("confirming");
		audio.play(assets.audio.click, { volume: 0.6 });

		try {
			const lamports = BigInt(Math.round(Number.parseFloat(amount) * 1e9));
			await initiateWager.execute({
				opponent: opponent.trim() as Address,
				amount: lamports,
				challengerChoice: choice,
				challengerBagMint: diceBagMint as Address,
			});

			setTxState("success");
			// No inline notification — server-driven wager_received event
			// in DiceDuelUIContainer handles the "Wager Sent!" toast for initiator.

			queryClient.invalidateQueries({
				queryKey: queryKeys.inventoryWagers.all(),
			});
			queryClient.invalidateQueries({ queryKey: queryKeys.diceBags.all() });

			setTimeout(() => {
				setTxState("idle");
				if (onClose) onClose();
			}, 800);
		} catch (e: any) {
			const decoded = logDiceDuelError("initiateWager", e);
			setTxState("error");
			// Error 6008 (InvalidWagerStatus) during initiateWager means the player has a
			// pending wager on-chain that the indexer didn't capture. The program won't allow
			// creating a new wager until the previous one is cancelled or expires (600s).
			const msg =
				decoded.code === 0x1778
					? "You have a pending wager that must be cancelled first. Check your inventory."
					: decoded.message;
			setErrorMsg(msg);
			audio.play(assets.audio.lose, { volume: 0.6 });
			notificationApi.notify({
				type: "error",
				title: "Error",
				message: `Wager failed: ${msg}`,
				channel: "dice-duel",
			});
			setTimeout(() => setTxState("idle"), 3000);
		}
	}, [
		validate,
		amount,
		opponent,
		choice,
		diceBagMint,
		initiateWager,
		queryClient,
		onClose,
	]);

	const busy = isLoading || txState === "confirming";
	const isFormValid =
		opponent.trim() &&
		Number(amount) > 0 &&
		selectedDice &&
		selectedDice.usesRemaining > 0;

	const displayOpponent =
		opponentName || (defaultOpponent ? truncAddr(defaultOpponent) : "");

	return (
		<Stack gap={4} style={{ padding: "1rem", minWidth: 300 }}>
			{/* Opponent Info */}
			<Stack gap={1}>
				{displayOpponent ? (
					<>
						<Typography variant="light" size="lg" bold>
							{displayOpponent}
						</Typography>
						{defaultOpponent && (
							<Typography variant="muted" size="xs">
								SVM: {truncAddr(defaultOpponent)}
							</Typography>
						)}
					</>
				) : (
					<Stack gap={2}>
						<Typography variant="muted" size="xs" bold>
							Opponent Address
						</Typography>
						<TextInput
							size="sm"
							placeholder="Base58 address..."
							value={opponent}
							onChange={(e) => setOpponent(e.target.value)}
							disabled={busy}
							style={{ fontSize: 11, fontFamily: "monospace" }}
						/>
					</Stack>
				)}
			</Stack>

			{/* Selected Dice — static display, no dropdown */}
			<Stack gap={2}>
				<Typography variant="muted" size="xs" bold>
					Your Dice
				</Typography>
				{selectedDice ? (
					<div>
						<Typography variant="light" size="sm">
							Dice {truncAddr(selectedDice.mint)}
						</Typography>
						<Typography variant="muted" size="xs">
							{selectedDice.usesRemaining} uses remaining
						</Typography>
					</div>
				) : (
					<StatusBox variant="error">
						<Typography variant="error" size="sm">
							{diceBagMint
								? "Selected dice bag not found"
								: "No dice bag selected"}
						</Typography>
					</StatusBox>
				)}
			</Stack>

			{/* Wager Amount */}
			<Stack gap={2}>
				<Typography variant="muted" size="xs" bold>
					Wager Amount (SOL)
				</Typography>
				<TextInput
					size="sm"
					type="number"
					placeholder="0.05"
					value={amount}
					onChange={(e) => setAmount(e.target.value)}
					disabled={busy}
					min={0}
					step={0.01}
				/>
				<Flex gap={2}>
					{PRESET_AMOUNTS.map((preset) => (
						<Button
							key={preset}
							size="sm"
							variant={amount === preset ? "primary" : "ghost"}
							onClick={() => {
								setAmount(preset);
								audio.play(assets.audio.click, { volume: 0.6 });
							}}
							disabled={busy}
							style={{ flex: 1, fontSize: 10 }}
						>
							{preset}
						</Button>
					))}
				</Flex>
			</Stack>

			{/* Position (Low/High) */}
			<Stack gap={2}>
				<Typography variant="muted" size="xs" bold>
					Your Position
				</Typography>
				<PositionPicker
					options={[
						{ value: 1, label: "High" },
						{ value: 0, label: "Low" },
					]}
					selected={choice}
					onSelect={(val) => setChoice(val as 0 | 1)}
					disabled={busy}
					size="sm"
				/>
			</Stack>

			{/* Summary */}
			<TransactionInfoBox
				rows={[
					{ label: "Your Wager", value: `${amount} SOL` },
					{
						label: "Opponent Must Match",
						value: `${amount} SOL`,
						variant: "gold",
					},
					{ label: "Your Bet", value: choice === 1 ? "High" : "Low" },
				]}
			/>

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
						Wager created successfully!
					</Typography>
				</StatusBox>
			)}

			{/* Action Buttons */}
			<div className={modalStyles.footer}>
				{onClose && (
					<Button
						variant="secondary"
						width="full"
						onClick={onClose}
						disabled={busy}
					>
						Cancel
					</Button>
				)}
				<Button
					variant="primary"
					width="full"
					onClick={handleSubmit}
					disabled={!isFormValid || busy}
				>
					{txState === "confirming" ? "Creating..." : "Create Wager"}
				</Button>
			</div>
		</Stack>
	);
};
