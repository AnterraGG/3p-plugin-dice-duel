/**
 * SvmShop — SVM mint shop for Dice Duel.
 *
 * Mints a DiceBag NFT via the on-chain mint_dice_bag instruction.
 * Generates a fresh keypair for the mint account and passes it as an
 * additional signer through the SDK.
 */

"use client";

import {
	type Address,
	createSolanaRpc,
	generateKeyPairSigner,
} from "@solana/kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	requireDefined,
	usePluginAudio,
	usePluginSvmCluster,
	usePluginSvmTransaction,
} from "@townexchange/3p-plugin-sdk/client";
import { formatSol } from "@townexchange/3p-plugin-sdk/shared";
import {
	Button,
	Flex,
	Typography,
	notificationApi,
} from "@townexchange/tex-ui-kit";
import { TokenIcon } from "@townexchange/token-icons";
import { useEffect, useState } from "react";
import { logDiceDuelError } from "../../../hooks/svm/errors";
import {
	queryKeys,
	useSvmGameConfig,
} from "../../../hooks/svm/queries-indexed";
import { assets } from "../../../../shared/assets";
import { useDiceDuelSvm } from "../../../hooks/svm/useDiceDuelSvm";
import styles from "./SvmShop.module.scss";

type TransactionState = "idle" | "confirming" | "success" | "error";

const RPC_URLS: Record<string, string> = {
	"mainnet-beta": "https://api.mainnet-beta.solana.com",
	devnet: "https://api.devnet.solana.com",
	testnet: "https://api.testnet.solana.com",
};

export const SvmShop = () => {
	const audio = usePluginAudio();
	const { walletAddress } = usePluginSvmTransaction();
	const cluster = requireDefined(usePluginSvmCluster(), "SVM cluster");
	const queryClient = useQueryClient();
	const { data: configData, isLoading: configLoading } = useSvmGameConfig();
	const { mintDiceBag, isLoading: isTxLoading } = useDiceDuelSvm();

	const [txState, setTxState] = useState<TransactionState>("idle");
	const [error, setError] = useState<string | null>(null);

	const isConnected = !!walletAddress;
	const rpcUrl = RPC_URLS[cluster ?? "devnet"] ?? RPC_URLS.devnet;

	// ─── SOL Balance ─────────────────────────────────────────────────────

	const { data: solBalance } = useQuery({
		queryKey: ["svm-sol-balance", walletAddress, cluster],
		queryFn: async () => {
			if (!walletAddress) return 0n;
			const rpc = createSolanaRpc(rpcUrl);
			const { value } = await rpc.getBalance(walletAddress as Address).send();
			return value;
		},
		enabled: isConnected,
		refetchInterval: 15_000,
	});

	// ─── Config ──────────────────────────────────────────────────────────

	const DEFAULT_MINT_PRICE_LAMPORTS = 50_000_000; // 0.05 SOL
	// Fallback treasury = the admin wallet that initialized the program
	const DEFAULT_TREASURY = "BLq7QBexFpPDg2WMu4JaL67X7SEdnyvXGtcoEvdncq4m";
	const mintPriceLamports = configData?.config?.mintPrice
		? Number(configData.config.mintPrice)
		: DEFAULT_MINT_PRICE_LAMPORTS;
	const formattedPrice = formatSol(BigInt(mintPriceLamports));
	const treasury = configData?.config?.treasury ?? DEFAULT_TREASURY;

	const hasInsufficientBalance =
		solBalance !== undefined && solBalance < BigInt(mintPriceLamports);

	// ─── Auto-reset on success ───────────────────────────────────────────

	useEffect(() => {
		if (txState === "success") {
			const timer = setTimeout(() => setTxState("idle"), 2000);
			return () => clearTimeout(timer);
		}
	}, [txState]);

	// ─── Mint Handler ────────────────────────────────────────────────────

	const handleMintBag = async () => {
		if (!treasury || hasInsufficientBalance) return;

		audio.play(assets.audio.click, { volume: 0.6 });
		setError(null);
		setTxState("confirming");

		try {
			// Generate a fresh keypair for the new mint account
			const mintSigner = await generateKeyPairSigner();
			const mintAddress = mintSigner.address as Address;

			await mintDiceBag.execute({
				mint: mintAddress,
				mintKeyPair: mintSigner.keyPair,
				treasury: treasury as Address,
			});

			setTxState("success");
			// No inline notification — server-driven dice_bag_minted event
			// in DiceDuelUIContainer handles the toast + sound.

			// SOL balance updates immediately (no indexer dependency)
			queryClient.invalidateQueries({ queryKey: ["svm-sol-balance"] });
			// Dice bag inventory will be refreshed by the NATS dice_bag_minted
			// notification via ctx.queries. Delayed invalidation here as fallback
			// in case the NATS pipeline is slow.
			setTimeout(() => {
				queryClient.invalidateQueries({ queryKey: queryKeys.diceBags.all() });
			}, 2_000);
		} catch (err) {
			const decoded = logDiceDuelError("mintDiceBag", err);
			setTxState("error");
			audio.play(assets.audio.lose, { volume: 0.6 });
			setError(decoded.message);
			notificationApi.notify({
				type: "error",
				title: "Mint Failed",
				message: decoded.message,
				channel: "dice-duel",
			});
		}
	};

	// ─── Button Text ─────────────────────────────────────────────────────

	const getButtonText = () => {
		if (!isConnected) return "Connect Wallet";
		if (configLoading && !treasury) return "Loading...";
		switch (txState) {
			case "confirming":
				return "Confirming...";
			case "success":
				return "Minted!";
			case "error":
				return "Try Again";
			default:
				if (hasInsufficientBalance) return "Insufficient SOL";
				return "Purchase";
		}
	};

	const isButtonDisabled =
		!isConnected ||
		txState === "confirming" ||
		txState === "success" ||
		hasInsufficientBalance ||
		!treasury;

	const getShortfallDisplay = () => {
		if (solBalance === undefined) return "?";
		const shortfall = BigInt(mintPriceLamports) - solBalance;
		return formatSol(shortfall > 0n ? shortfall : 0n);
	};

	// ─── Render ──────────────────────────────────────────────────────────

	return (
		<div className={styles.shopItem}>
			{/* Item icon */}
			<div className={styles.iconContainer}>
				<span className={styles.diceEmoji}>🎲</span>
				<Typography
					as="span"
					variant="muted"
					size="xs"
					className={styles.quantity}
				>
					x10
				</Typography>
			</div>

			{/* Item info */}
			<div className={styles.itemInfo}>
				<Typography variant="gold" size="md" bold>
					Bag of Dice
				</Typography>
				<Typography variant="muted" size="xs">
					Contains 10 dice rolls for wagering
				</Typography>
			</div>

			{/* Price */}
			<div className={styles.priceSection}>
				<Flex align="center" gap={1}>
					<TokenIcon ticker="SOL" size={14} />
					<Typography variant="light" size="lg" bold>
						{formattedPrice} SOL
					</Typography>
				</Flex>
			</div>

			{/* Balance warning */}
			{hasInsufficientBalance && (
				<div className={styles.balanceWarning}>
					<Typography variant="gold" size="xs">
						Need {getShortfallDisplay()} more SOL
					</Typography>
				</div>
			)}

			{/* Purchase button */}
			<Button
				variant="primary"
				size="sm"
				width="full"
				onClick={handleMintBag}
				disabled={isButtonDisabled}
			>
				{txState === "confirming" && <span className={styles.spinner} />}
				{getButtonText()}
			</Button>

			{/* Error message */}
			{error && (
				<div className={styles.errorMessage}>
					<Typography variant="error" size="xs">
						{error}
					</Typography>
				</div>
			)}
		</div>
	);
};
