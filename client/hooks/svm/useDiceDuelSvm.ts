/**
 * DiceDuel SVM Game Actions Hook
 *
 * Uses Codama-generated instruction builders + SDK adapter (toSvmIx)
 * and useTransactionBuilder for per-action state management.
 */

import type { Address } from "@solana/kit";
import {
	createErrorDecoder,
	createStubSigner,
	toSvmIx,
} from "@townexchange/3p-plugin-sdk/anchor";
import {
	requireDefined,
	usePluginIndexerApi,
	usePluginSvmCluster,
	usePluginSvmTransaction,
	useTransactionBuilder,
	useTransactionGroup,
} from "@townexchange/3p-plugin-sdk/client";
import { fetchSvmPlayerStats } from "../../api/svmApi";

import { getDiceDuelErrorMessage } from "#generated/clients/svm/dice-duel/errors";
// Codama-generated instruction builders
import {
	getAcceptWagerInstructionAsync,
	getCancelWagerInstructionAsync,
	getClaimExpiredInstructionAsync,
	getClaimVrfTimeoutInstructionAsync,
	getClaimWinningsInstructionAsync,
	getCleanupStaleWagerInstructionAsync,
	getInitiateWagerInstructionAsync,
	getMintDiceBagInstructionAsync,
} from "#generated/clients/svm/dice-duel/instructions";
import {
	findDiceBagPda,
	findEscrowPda,
	findStatsPda,
	findWagerPda,
} from "#generated/clients/svm/dice-duel/pdas";

import {
	DEFAULT_QUEUE,
	MPL_CORE_PROGRAM_ID,
	SLOT_HASHES_SYSVAR,
	VRF_PROGRAM_ID,
} from "./constants";

// ─── Error Decoder ─────────────────────────────────────────────────────────

const errorDecoder = createErrorDecoder((code) =>
	getDiceDuelErrorMessage(
		code as Parameters<typeof getDiceDuelErrorMessage>[0],
	),
);

// ─── Types ─────────────────────────────────────────────────────────────────

/** Web Crypto KeyPair — declared locally for Node-context type compatibility. */
type WebCryptoKeyPair = { publicKey: CryptoKey; privateKey: CryptoKey };

export interface MintDiceBagParams {
	mint: Address;
	mintKeyPair: WebCryptoKeyPair;
	treasury: Address;
}

export interface InitiateWagerParams {
	opponent: Address;
	amount: bigint;
	gameType?: number;
	challengerChoice: 0 | 1;
	challengerBagMint: Address;
}

export interface AcceptWagerParams {
	challenger: Address;
	challengerBagPda: Address;
	nonce: bigint;
}

export interface CancelWagerParams {
	nonce: bigint;
}

export interface ClaimExpiredParams {
	challenger: Address;
	nonce: bigint;
}

export interface ClaimVrfTimeoutParams {
	challenger: Address;
	opponent: Address;
	nonce: bigint;
}

export interface ClaimWinningsParams {
	challenger: Address;
	treasury: Address;
	nonce: bigint;
}

export interface CleanupStaleWagerParams {
	challenger: Address;
	nonce: bigint;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useDiceDuelSvm() {
	const cluster = requireDefined(usePluginSvmCluster(), "SVM cluster");
	const api = usePluginIndexerApi("svm");
	const {
		sendInstructions,
		isLoading,
		error,
		lastSignature,
		walletAddress,
		isReady,
		reset,
	} = usePluginSvmTransaction();

	const playerAddress = walletAddress as Address | null;

	// createStubSigner from SDK — the bridge handles actual signing

	const txOpts = { errorDecoder };

	// ─── Transaction Actions ───────────────────────────────────────────

	const mintDiceBag = useTransactionBuilder(
		"mintDiceBag",
		async (params: MintDiceBagParams) => {
			if (!playerAddress) throw new Error("Wallet not connected");
			const ix = await getMintDiceBagInstructionAsync({
				player: createStubSigner(playerAddress),
				mint: createStubSigner(params.mint),
				treasury: params.treasury,
				mplCoreProgram: MPL_CORE_PROGRAM_ID,
			});
			return sendInstructions({
				instructions: [toSvmIx(ix)],
				computeUnits: 200_000,
				additionalSigners: { [params.mint as string]: params.mintKeyPair },
			});
		},
		txOpts,
	);

	const initiateWager = useTransactionBuilder(
		"initiateWager",
		async (params: InitiateWagerParams) => {
			if (!playerAddress) throw new Error("Wallet not connected");
			const gameType = params.gameType ?? 0;
			const statsResp = await fetchSvmPlayerStats(api, playerAddress as string);
			const stats = statsResp.stats;
			const currentNonce = BigInt(stats?.wagerNonce ?? "0");
			const pendingNonce =
				stats?.pendingNonce != null ? BigInt(stats.pendingNonce) : null;

			const [challengerBagPda] = await findDiceBagPda(params.challengerBagMint);
			const [wagerPda] = await findWagerPda(playerAddress, currentNonce);

			let prevWager: Address | undefined;
			let prevEscrow: Address | undefined;
			if (pendingNonce !== null) {
				const [prevWagerPda] = await findWagerPda(playerAddress, pendingNonce);
				const [prevEscrowPda] = await findEscrowPda(prevWagerPda);
				prevWager = prevWagerPda;
				prevEscrow = prevEscrowPda;
			}

			const ix = await getInitiateWagerInstructionAsync({
				challenger: createStubSigner(playerAddress),
				challengerBag: challengerBagPda,
				wager: wagerPda,
				prevWager,
				prevEscrow,
				opponent: params.opponent,
				amount: params.amount,
				gameType,
				challengerChoice: params.challengerChoice,
			});
			return sendInstructions({
				instructions: [toSvmIx(ix)],
				computeUnits: 200_000,
			});
		},
		txOpts,
	);

	const acceptWager = useTransactionBuilder(
		"acceptWager",
		async (params: AcceptWagerParams) => {
			if (!playerAddress) throw new Error("Wallet not connected");
			const [wagerPda] = await findWagerPda(params.challenger, params.nonce);
			const [challengerStatsPda] = await findStatsPda(params.challenger);
			const ix = await getAcceptWagerInstructionAsync({
				opponent: createStubSigner(playerAddress),
				wager: wagerPda,
				challenger: params.challenger,
				challengerBag: params.challengerBagPda,
				challengerStats: challengerStatsPda,
				oracleQueue: DEFAULT_QUEUE,
				vrfProgram: VRF_PROGRAM_ID,
				slotHashes: SLOT_HASHES_SYSVAR,
			});
			return sendInstructions({
				instructions: [toSvmIx(ix)],
				computeUnits: 400_000,
			});
		},
		txOpts,
	);

	const cancelWager = useTransactionBuilder(
		"cancelWager",
		async (params: CancelWagerParams) => {
			if (!playerAddress) throw new Error("Wallet not connected");
			const [wagerPda] = await findWagerPda(playerAddress, params.nonce);
			const ix = await getCancelWagerInstructionAsync({
				challenger: createStubSigner(playerAddress),
				wager: wagerPda,
			});
			return sendInstructions({
				instructions: [toSvmIx(ix)],
				computeUnits: 100_000,
			});
		},
		txOpts,
	);

	const claimExpired = useTransactionBuilder(
		"claimExpired",
		async (params: ClaimExpiredParams) => {
			if (!playerAddress) throw new Error("Wallet not connected");
			const [wagerPda] = await findWagerPda(params.challenger, params.nonce);
			const [challengerStatsPda] = await findStatsPda(params.challenger);
			const ix = await getClaimExpiredInstructionAsync({
				caller: createStubSigner(playerAddress),
				wager: wagerPda,
				challenger: params.challenger,
				challengerStats: challengerStatsPda,
			});
			return sendInstructions({
				instructions: [toSvmIx(ix)],
				computeUnits: 100_000,
			});
		},
		txOpts,
	);

	const claimWinnings = useTransactionBuilder(
		"claimWinnings",
		async (params: ClaimWinningsParams) => {
			if (!playerAddress) throw new Error("Wallet not connected");
			const [wagerPda] = await findWagerPda(params.challenger, params.nonce);
			const ix = await getClaimWinningsInstructionAsync({
				claimer: createStubSigner(playerAddress),
				wager: wagerPda,
				challenger: params.challenger,
				treasury: params.treasury,
			});
			return sendInstructions({
				instructions: [toSvmIx(ix)],
				computeUnits: 200_000,
			});
		},
		txOpts,
	);

	const claimVrfTimeout = useTransactionBuilder(
		"claimVrfTimeout",
		async (params: ClaimVrfTimeoutParams) => {
			if (!playerAddress) throw new Error("Wallet not connected");
			const [wagerPda] = await findWagerPda(params.challenger, params.nonce);
			const ix = await getClaimVrfTimeoutInstructionAsync({
				caller: createStubSigner(playerAddress),
				wager: wagerPda,
				challenger: params.challenger,
				opponent: params.opponent,
			});
			return sendInstructions({
				instructions: [toSvmIx(ix)],
				computeUnits: 100_000,
			});
		},
		txOpts,
	);

	const cleanupStaleWager = useTransactionBuilder(
		"cleanupStaleWager",
		async (params: CleanupStaleWagerParams) => {
			if (!playerAddress) throw new Error("Wallet not connected");
			const [wagerPda] = await findWagerPda(params.challenger, params.nonce);
			const [challengerStatsPda] = await findStatsPda(params.challenger);
			const ix = await getCleanupStaleWagerInstructionAsync({
				payer: createStubSigner(playerAddress),
				wager: wagerPda,
				challengerStats: challengerStatsPda,
				challenger: params.challenger,
			});
			return sendInstructions({
				instructions: [toSvmIx(ix)],
				computeUnits: 100_000,
			});
		},
		txOpts,
	);

	// ─── Aggregate state ───────────────────────────────────────────────

	const txGroup = useTransactionGroup({
		mintDiceBag,
		initiateWager,
		acceptWager,
		cancelWager,
		claimExpired,
		claimVrfTimeout,
		claimWinnings,
		cleanupStaleWager,
	});

	return {
		mintDiceBag,
		initiateWager,
		acceptWager,
		cancelWager,
		claimExpired,
		claimVrfTimeout,
		claimWinnings,
		cleanupStaleWager,
		isLoading: isLoading || txGroup.isAnyPending,
		isPending: txGroup.isAnyPending,
		error,
		lastSignature,
		walletAddress: playerAddress,
		isReady,
		cluster,
		reset,
		txGroup,
	};
}
