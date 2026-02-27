/**
 * DiceDuel Test Helpers — @solana/kit + LiteSVM compat layer
 *
 * Primary types use @solana/kit (Address, KeyPairSigner, bigint).
 * Legacy @solana/web3.js types are used ONLY at the LiteSVM boundary,
 * wrapped in thin helper functions prefixed with "svm*".
 */

// ─── SECTION 1: Kit imports (primary) ─────────────────────────────────
import {
	type Address,
	type KeyPairSigner,
	address,
	createKeyPairSignerFromBytes,
	generateKeyPairSigner,
	getAddressEncoder,
	getProgramDerivedAddress,
	getUtf8Encoder,
} from "@solana/kit";
import { DICE_DUEL_PROGRAM_ID } from "../../../shared/programs";

import fs from "fs";
import path from "path";
import { BorshCoder } from "@coral-xyz/anchor";
// ─── SECTION 2: Legacy imports (ONLY for LiteSVM boundary) ───────────
import {
	Keypair as LegacyKeypair,
	PublicKey as LegacyPublicKey,
	Transaction as LegacyTransaction,
	TransactionInstruction as LegacyTransactionInstruction,
	SystemProgram,
} from "@solana/web3.js";
import { Clock, LiteSVM } from "litesvm";

// ─── SECTION 3: LiteSVM wrapper functions (thin boundary layer) ──────

function toLegacyPublicKey(addr: Address): LegacyPublicKey {
	return new LegacyPublicKey(addr);
}

/**
 * TestSigner: a KeyPairSigner that also carries its legacy Keypair for litesvm.
 * Generated from the same 64-byte secret key so both representations match.
 */
interface TestSigner extends KeyPairSigner {
	_legacyKeypair: LegacyKeypair;
}

function toLegacyKeypair(signer: TestSigner): LegacyKeypair {
	return signer._legacyKeypair;
}

async function createTestSigner(): Promise<TestSigner> {
	const legacyKp = LegacyKeypair.generate();
	const signer = await createKeyPairSignerFromBytes(legacyKp.secretKey);
	// Kit signers are frozen — wrap with legacy keypair attached
	return Object.create(signer, {
		_legacyKeypair: { value: legacyKp, enumerable: false },
	}) as TestSigner;
}

function svmAirdrop(svm: LiteSVM, addr: Address, lamports: bigint): void {
	svm.airdrop(toLegacyPublicKey(addr), lamports);
}

function svmGetAccount(svm: LiteSVM, addr: Address) {
	return svm.getAccount(toLegacyPublicKey(addr));
}

function svmSetAccount(
	svm: LiteSVM,
	addr: Address,
	account: {
		lamports: bigint;
		data: Uint8Array;
		owner: LegacyPublicKey;
		executable: boolean;
		rentEpoch: bigint;
	},
): void {
	svm.setAccount(toLegacyPublicKey(addr), account);
}

function svmAddProgramFromFile(
	svm: LiteSVM,
	programId: Address,
	soPath: string,
): void {
	svm.addProgramFromFile(toLegacyPublicKey(programId), soPath);
}

/** Build and send a LegacyTransaction from kit-style instruction data. */
async function svmSendTransaction(
	svm: LiteSVM,
	instructions: Array<KitInstruction>,
	signers: Array<KeyPairSigner>,
	payer: Address,
): Promise<{ success: boolean; meta: any; error?: any }> {
	const tx = new LegacyTransaction();
	for (const ix of instructions) {
		tx.add(
			new LegacyTransactionInstruction({
				keys: ix.keys.map((k) => ({
					pubkey: toLegacyPublicKey(k.pubkey),
					isSigner: k.isSigner,
					isWritable: k.isWritable,
				})),
				programId: toLegacyPublicKey(ix.programId),
				data: ix.data,
			}),
		);
	}
	tx.recentBlockhash = svm.latestBlockhash();
	tx.feePayer = toLegacyPublicKey(payer);

	const legacySigners = signers.map((s) => toLegacyKeypair(s as TestSigner));
	tx.sign(...legacySigners);

	const result = svm.sendTransaction(tx);
	if ("err" in result && typeof result.err === "function") {
		try {
			const errVal = result.err();
			if (errVal !== null && errVal !== undefined) {
				return { success: false, meta: result, error: errVal };
			}
		} catch {
			// Not a failure
		}
	}
	return { success: true, meta: result };
}

// ─── Internal instruction type (kit-native) ──────────────────────────

interface KitAccountMeta {
	pubkey: Address;
	isSigner: boolean;
	isWritable: boolean;
}

interface KitInstruction {
	keys: Array<KitAccountMeta>;
	programId: Address;
	data: Buffer;
}

// ─── SECTION 4: Constants, seeds, PDAs (all kit types) ───────────────

// Program IDs
export const PROGRAM_ID: Address = address(DICE_DUEL_PROGRAM_ID);
export const MPL_CORE_PROGRAM_ID: Address = address(
	"CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
);
export const SYSTEM_PROGRAM_ID: Address = address(
	"11111111111111111111111111111111",
);

// VRF constants
export const VRF_PROGRAM_ID: Address = address(
	"Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
);
export const VRF_PROGRAM_IDENTITY: Address = address(
	"9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw",
);
export const DEFAULT_QUEUE: Address = address(
	"Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);

// Seeds
const utf8 = getUtf8Encoder();
export const SEED_CONFIG = utf8.encode("config");
export const SEED_DICE_BAG = utf8.encode("dice_bag");
export const SEED_WAGER = utf8.encode("wager");
export const SEED_ESCROW = utf8.encode("escrow");
export const SEED_STATS = utf8.encode("stats");
export const SEED_GAME_TYPE = utf8.encode("game_type");

// Default config values
export const DEFAULT_FEE_BPS = 500;
export const DEFAULT_MINT_PRICE = 50_000_000n; // 0.05 SOL
export const DEFAULT_INITIAL_USES = 10;
export const DEFAULT_WAGER_EXPIRY = 600n; // 10 min
export const DEFAULT_VRF_TIMEOUT = 900n; // 15 min

export const LAMPORTS_PER_SOL = 1_000_000_000n;

// Plugin root
const PLUGIN_ROOT = path.resolve(import.meta.dirname, "../../../");

// Load IDL
const idlPath = path.join(PLUGIN_ROOT, "target/idl/dice_duel.json");
export const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
const coder = new BorshCoder(IDL);

// ─── PDA Derivation (async — kit's getProgramDerivedAddress is async) ─

const addrEncoder = getAddressEncoder();

export async function getConfigPDA(): Promise<[Address, number]> {
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [SEED_CONFIG],
	});
}

export async function getDiceBagPDA(mint: Address): Promise<[Address, number]> {
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [SEED_DICE_BAG, addrEncoder.encode(mint)],
	});
}

export async function getWagerPDA(
	challenger: Address,
): Promise<[Address, number]> {
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [SEED_WAGER, addrEncoder.encode(challenger)],
	});
}

export async function getEscrowPDA(wager: Address): Promise<[Address, number]> {
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [SEED_ESCROW, addrEncoder.encode(wager)],
	});
}

export async function getStatsPDA(player: Address): Promise<[Address, number]> {
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [SEED_STATS, addrEncoder.encode(player)],
	});
}

export async function getGameTypePDA(id: number): Promise<[Address, number]> {
	const idBuffer = new Uint8Array([id]);
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [SEED_GAME_TYPE, idBuffer],
	});
}

// ─── SECTION 5: Instruction Builders (kit types, async for PDAs) ─────

function encodeInstruction(
	name: string,
	args: Record<string, unknown>,
): Buffer {
	return coder.instruction.encode(name, args);
}

// BN — only used internally for Anchor's BorshCoder encoding, never in public API
import BN from "bn.js";

/** Convert bigint → BN for Anchor's BorshCoder. */
function bn(value: bigint): BN {
	return new BN(value.toString());
}

export async function buildInitializeIx(
	admin: Address,
	treasury: Address,
	feeBps: number,
	mintPrice: bigint,
	initialUses: number,
	wagerExpirySeconds: bigint,
	vrfTimeoutSeconds: bigint,
): Promise<KitInstruction> {
	const [config] = await getConfigPDA();
	const data = encodeInstruction("initialize", {
		treasury: toLegacyPublicKey(treasury),
		fee_bps: feeBps,
		mint_price: bn(mintPrice),
		initial_uses: initialUses,
		wager_expiry_seconds: bn(wagerExpirySeconds),
		vrf_timeout_seconds: bn(vrfTimeoutSeconds),
	});
	return {
		keys: [
			{ pubkey: admin, isSigner: true, isWritable: true },
			{ pubkey: config, isSigner: false, isWritable: true },
			{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildMintDiceBagIx(
	player: Address,
	mint: Address,
	treasury: Address,
): Promise<KitInstruction> {
	const [config] = await getConfigPDA();
	const [diceBag] = await getDiceBagPDA(mint);
	const data = encodeInstruction("mint_dice_bag", {});
	return {
		keys: [
			{ pubkey: player, isSigner: true, isWritable: true },
			{ pubkey: config, isSigner: false, isWritable: false },
			{ pubkey: mint, isSigner: true, isWritable: true },
			{ pubkey: diceBag, isSigner: false, isWritable: true },
			{ pubkey: treasury, isSigner: false, isWritable: true },
			{ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildInitiateWagerIx(
	challenger: Address,
	challengerBagMint: Address,
	opponent: Address,
	amount: bigint,
	gameType: number,
	challengerChoice: number,
): Promise<KitInstruction> {
	const [challengerBag] = await getDiceBagPDA(challengerBagMint);
	const [wager] = await getWagerPDA(challenger);
	const [escrow] = await getEscrowPDA(wager);
	const [config] = await getConfigPDA();
	const [gameTypeAccount] = await getGameTypePDA(gameType);
	const data = encodeInstruction("initiate_wager", {
		opponent: toLegacyPublicKey(opponent),
		amount: bn(amount),
		game_type: gameType,
		challenger_choice: challengerChoice,
	});
	return {
		keys: [
			{ pubkey: challenger, isSigner: true, isWritable: true },
			{ pubkey: challengerBag, isSigner: false, isWritable: false },
			{ pubkey: wager, isSigner: false, isWritable: true },
			{ pubkey: escrow, isSigner: false, isWritable: true },
			{ pubkey: config, isSigner: false, isWritable: false },
			{ pubkey: gameTypeAccount, isSigner: false, isWritable: false },
			{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildCancelWagerIx(
	challenger: Address,
): Promise<KitInstruction> {
	const [wager] = await getWagerPDA(challenger);
	const [escrow] = await getEscrowPDA(wager);
	const data = encodeInstruction("cancel_wager", {});
	return {
		keys: [
			{ pubkey: challenger, isSigner: true, isWritable: true },
			{ pubkey: wager, isSigner: false, isWritable: true },
			{ pubkey: escrow, isSigner: false, isWritable: true },
			{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildConsumeRandomnessIx(
	vrfIdentity: Address,
	challengerKey: Address,
	opponentKey: Address,
	challengerBagMint: Address,
	treasury: Address,
	randomness: Buffer,
): Promise<KitInstruction> {
	const [wager] = await getWagerPDA(challengerKey);
	const [escrow] = await getEscrowPDA(wager);
	const [challengerBag] = await getDiceBagPDA(challengerBagMint);
	const [challengerStats] = await getStatsPDA(challengerKey);
	const [opponentStats] = await getStatsPDA(opponentKey);
	const [config] = await getConfigPDA();
	const data = encodeInstruction("consume_randomness", {
		randomness: Array.from(randomness),
	});
	return {
		keys: [
			{ pubkey: vrfIdentity, isSigner: true, isWritable: false },
			{ pubkey: wager, isSigner: false, isWritable: true },
			{ pubkey: escrow, isSigner: false, isWritable: true },
			{ pubkey: challengerKey, isSigner: false, isWritable: true },
			{ pubkey: opponentKey, isSigner: false, isWritable: true },
			{ pubkey: challengerBag, isSigner: false, isWritable: true },
			{ pubkey: challengerStats, isSigner: false, isWritable: true },
			{ pubkey: opponentStats, isSigner: false, isWritable: true },
			{ pubkey: config, isSigner: false, isWritable: false },
			{ pubkey: treasury, isSigner: false, isWritable: true },
			{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildClaimVrfTimeoutIx(
	caller: Address,
	challengerKey: Address,
	opponentKey: Address,
): Promise<KitInstruction> {
	const [wager] = await getWagerPDA(challengerKey);
	const [escrow] = await getEscrowPDA(wager);
	const [config] = await getConfigPDA();
	const data = encodeInstruction("claim_vrf_timeout", {});
	return {
		keys: [
			{ pubkey: caller, isSigner: true, isWritable: false },
			{ pubkey: wager, isSigner: false, isWritable: true },
			{ pubkey: escrow, isSigner: false, isWritable: true },
			{ pubkey: challengerKey, isSigner: false, isWritable: true },
			{ pubkey: opponentKey, isSigner: false, isWritable: true },
			{ pubkey: config, isSigner: false, isWritable: false },
			{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildClaimExpiredIx(
	caller: Address,
	challengerKey: Address,
): Promise<KitInstruction> {
	const [wager] = await getWagerPDA(challengerKey);
	const [escrow] = await getEscrowPDA(wager);
	const [config] = await getConfigPDA();
	const data = encodeInstruction("claim_expired", {});
	return {
		keys: [
			{ pubkey: caller, isSigner: true, isWritable: false },
			{ pubkey: wager, isSigner: false, isWritable: true },
			{ pubkey: escrow, isSigner: false, isWritable: true },
			{ pubkey: challengerKey, isSigner: false, isWritable: true },
			{ pubkey: config, isSigner: false, isWritable: false },
			{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildUpdateConfigIx(
	admin: Address,
	args: {
		treasury: Address | null;
		feeBps: number | null;
		mintPrice: bigint | null;
		initialUses: number | null;
		wagerExpirySeconds: bigint | null;
		vrfTimeoutSeconds: bigint | null;
	},
): Promise<KitInstruction> {
	const [config] = await getConfigPDA();
	const data = encodeInstruction("update_config", {
		treasury: args.treasury ? toLegacyPublicKey(args.treasury) : null,
		fee_bps: args.feeBps,
		mint_price: args.mintPrice !== null ? bn(args.mintPrice) : null,
		initial_uses: args.initialUses,
		wager_expiry_seconds:
			args.wagerExpirySeconds !== null ? bn(args.wagerExpirySeconds) : null,
		vrf_timeout_seconds:
			args.vrfTimeoutSeconds !== null ? bn(args.vrfTimeoutSeconds) : null,
	});
	return {
		keys: [
			{ pubkey: admin, isSigner: true, isWritable: false },
			{ pubkey: config, isSigner: false, isWritable: true },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildPauseIx(admin: Address): Promise<KitInstruction> {
	const [config] = await getConfigPDA();
	const data = encodeInstruction("pause", {});
	return {
		keys: [
			{ pubkey: admin, isSigner: true, isWritable: false },
			{ pubkey: config, isSigner: false, isWritable: true },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildUnpauseIx(admin: Address): Promise<KitInstruction> {
	const [config] = await getConfigPDA();
	const data = encodeInstruction("unpause", {});
	return {
		keys: [
			{ pubkey: admin, isSigner: true, isWritable: false },
			{ pubkey: config, isSigner: false, isWritable: true },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildRegisterGameTypeIx(
	admin: Address,
	id: number,
	name: string,
	enabled: boolean,
): Promise<KitInstruction> {
	const [config] = await getConfigPDA();
	const [gameType] = await getGameTypePDA(id);
	const data = encodeInstruction("register_game_type", { id, name, enabled });
	return {
		keys: [
			{ pubkey: admin, isSigner: true, isWritable: true },
			{ pubkey: config, isSigner: false, isWritable: false },
			{ pubkey: gameType, isSigner: false, isWritable: true },
			{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		programId: PROGRAM_ID,
		data,
	};
}

export async function buildUpdateGameTypeIx(
	admin: Address,
	id: number,
	name: string | null,
	enabled: boolean | null,
): Promise<KitInstruction> {
	const [config] = await getConfigPDA();
	const [gameType] = await getGameTypePDA(id);
	const data = encodeInstruction("update_game_type", { name, enabled });
	return {
		keys: [
			{ pubkey: admin, isSigner: true, isWritable: false },
			{ pubkey: config, isSigner: false, isWritable: false },
			{ pubkey: gameType, isSigner: false, isWritable: true },
		],
		programId: PROGRAM_ID,
		data,
	};
}

// ─── SECTION 6: SVM Setup Helpers ────────────────────────────────────

const PROGRAM_SO_PATH = path.join(PLUGIN_ROOT, "target/deploy/dice_duel.so");
const MPL_CORE_SO_PATH = path.join(PLUGIN_ROOT, "target/deploy/mpl_core.so");

export function createSVM(): LiteSVM {
	const svm = new LiteSVM();
	svmAddProgramFromFile(svm, PROGRAM_ID, PROGRAM_SO_PATH);
	if (fs.existsSync(MPL_CORE_SO_PATH)) {
		svmAddProgramFromFile(svm, MPL_CORE_PROGRAM_ID, MPL_CORE_SO_PATH);
	}
	return svm;
}

export function fundAccount(
	svm: LiteSVM,
	addr: Address,
	lamports: bigint = 10n * LAMPORTS_PER_SOL,
): void {
	svmAirdrop(svm, addr, lamports);
}

// ─── SECTION 7: Transaction Helpers (use wrappers) ───────────────────

export async function sendTransaction(
	svm: LiteSVM,
	instructions: Array<KitInstruction>,
	signers: Array<KeyPairSigner>,
	payer: Address,
): Promise<{ success: boolean; meta: any; error?: any }> {
	return svmSendTransaction(svm, instructions, signers, payer);
}

export async function sendAndExpectSuccess(
	svm: LiteSVM,
	instructions: Array<KitInstruction>,
	signers: Array<KeyPairSigner>,
	payer: Address,
): Promise<any> {
	const result = await sendTransaction(svm, instructions, signers, payer);
	if (!result.success) {
		const meta = result.meta;
		let logs = "";
		try {
			logs = meta.meta().logs().join("\n");
		} catch {
			try {
				logs = meta.logs().join("\n");
			} catch {
				// no logs
			}
		}
		throw new Error(`Transaction failed: ${result.error}\nLogs:\n${logs}`);
	}
	return result.meta;
}

export async function sendAndExpectFailure(
	svm: LiteSVM,
	instructions: Array<KitInstruction>,
	signers: Array<KeyPairSigner>,
	payer: Address,
): Promise<any> {
	const result = await sendTransaction(svm, instructions, signers, payer);
	if (result.success) {
		throw new Error("Expected transaction to fail, but it succeeded");
	}
	return result.error;
}

// ─── SECTION 8: Account Decoding / Writing ───────────────────────────

export function decodeAccount<T>(
	svm: LiteSVM,
	addr: Address,
	accountName: string,
): T {
	const accountInfo = svmGetAccount(svm, addr);
	if (!accountInfo) {
		throw new Error(`Account not found: ${addr}`);
	}
	const data = Buffer.from(accountInfo.data);
	return coder.accounts.decode(accountName, data) as T;
}

// Decoded account interfaces — field types match what BorshCoder returns
// (PublicKey/BN from anchor). Consumers can convert as needed.
export interface GameConfigData {
	admin: LegacyPublicKey;
	treasury: LegacyPublicKey;
	fee_bps: number;
	mint_price: BN;
	initial_uses: number;
	is_paused: boolean;
	wager_expiry_seconds: BN;
	vrf_timeout_seconds: BN;
	bump: number;
}

export interface DiceBagData {
	mint: LegacyPublicKey;
	owner: LegacyPublicKey;
	uses_remaining: number;
	total_games: number;
	wins: number;
	losses: number;
	bump: number;
}

export interface WagerData {
	challenger: LegacyPublicKey;
	opponent: LegacyPublicKey;
	challenger_bag: LegacyPublicKey;
	amount: BN;
	game_type: number;
	challenger_choice: number;
	status: any;
	vrf_requested_at: BN;
	vrf_result: number | null;
	winner: LegacyPublicKey | null;
	created_at: BN;
	settled_at: BN | null;
	threshold: number;
	payout_multiplier_bps: number;
	escrow_bump: number;
	bump: number;
}

export interface PlayerStatsData {
	player: LegacyPublicKey;
	total_games: number;
	wins: number;
	losses: number;
	sol_wagered: BN;
	sol_won: BN;
	current_streak: number;
	best_streak: number;
	bump: number;
}

export interface GameTypeData {
	id: number;
	name: Array<number>;
	enabled: boolean;
	bump: number;
}

// ─── Account State Writers (for bypassing CPI-heavy instructions) ─────

export async function writeWagerAccount(
	svm: LiteSVM,
	challenger: Address,
	opponent: Address,
	challengerBagMint: Address,
	amount: bigint,
	status: number, // 0=Pending, 1=Active, etc.
	createdAt: bigint,
	vrfRequestedAt = 0n,
): Promise<void> {
	await writeWagerAccountWithChoice(
		svm,
		challenger,
		opponent,
		challengerBagMint,
		amount,
		status,
		1,
		createdAt,
		vrfRequestedAt,
	);
}

export async function writeWagerAccountWithChoice(
	svm: LiteSVM,
	challenger: Address,
	opponent: Address,
	challengerBagMint: Address,
	amount: bigint,
	status: number,
	challengerChoice: number,
	createdAt: bigint,
	vrfRequestedAt = 0n,
): Promise<void> {
	const [wagerPDA, wagerBump] = await getWagerPDA(challenger);
	const [, escrowBump] = await getEscrowPDA(wagerPDA);

	const statusKeys = [
		"Pending",
		"Active",
		"Settled",
		"Cancelled",
		"Expired",
		"VrfTimeout",
	];
	const statusObj: Record<string, object> = {};
	statusObj[statusKeys[status]] = {};

	const encoded = await coder.accounts.encode("Wager", {
		challenger: toLegacyPublicKey(challenger),
		opponent: toLegacyPublicKey(opponent),
		challenger_bag: toLegacyPublicKey(challengerBagMint),
		amount: bn(amount),
		game_type: 0,
		challenger_choice: challengerChoice,
		status: statusObj,
		vrf_requested_at: bn(vrfRequestedAt),
		vrf_result: null,
		winner: null,
		created_at: bn(createdAt),
		settled_at: null,
		threshold: 50,
		payout_multiplier_bps: 10000,
		escrow_bump: escrowBump,
		bump: wagerBump,
	});

	svmSetAccount(svm, wagerPDA, {
		lamports: svm.minimumBalanceForRentExemption(BigInt(encoded.length - 8)),
		data: new Uint8Array(encoded),
		owner: toLegacyPublicKey(PROGRAM_ID),
		executable: false,
		rentEpoch: 0n,
	});
}

export async function writePlayerStatsAccount(
	svm: LiteSVM,
	player: Address,
	stats?: Partial<{
		total_games: number;
		wins: number;
		losses: number;
		sol_wagered: bigint;
		sol_won: bigint;
		current_streak: number;
		best_streak: number;
	}>,
): Promise<void> {
	const [statsPDA, bump] = await getStatsPDA(player);

	const encoded = await coder.accounts.encode("PlayerStats", {
		player: toLegacyPublicKey(player),
		total_games: stats?.total_games ?? 0,
		wins: stats?.wins ?? 0,
		losses: stats?.losses ?? 0,
		sol_wagered: bn(stats?.sol_wagered ?? 0n),
		sol_won: bn(stats?.sol_won ?? 0n),
		current_streak: stats?.current_streak ?? 0,
		best_streak: stats?.best_streak ?? 0,
		bump,
	});

	svmSetAccount(svm, statsPDA, {
		lamports: svm.minimumBalanceForRentExemption(BigInt(encoded.length - 8)),
		data: new Uint8Array(encoded),
		owner: toLegacyPublicKey(PROGRAM_ID),
		executable: false,
		rentEpoch: 0n,
	});
}

export async function writeDiceBagAccount(
	svm: LiteSVM,
	mint: Address,
	owner: Address,
	usesRemaining = 10,
): Promise<void> {
	const [diceBagPDA, bump] = await getDiceBagPDA(mint);

	const encoded = await coder.accounts.encode("DiceBag", {
		mint: toLegacyPublicKey(mint),
		owner: toLegacyPublicKey(owner),
		uses_remaining: usesRemaining,
		total_games: 0,
		wins: 0,
		losses: 0,
		bump,
	});

	svmSetAccount(svm, diceBagPDA, {
		lamports: svm.minimumBalanceForRentExemption(BigInt(encoded.length - 8)),
		data: new Uint8Array(encoded),
		owner: toLegacyPublicKey(PROGRAM_ID),
		executable: false,
		rentEpoch: 0n,
	});
}

export async function fundEscrow(
	svm: LiteSVM,
	challenger: Address,
	lamports: bigint,
): Promise<void> {
	const [wager] = await getWagerPDA(challenger);
	const [escrow] = await getEscrowPDA(wager);
	svmSetAccount(svm, escrow, {
		lamports,
		data: new Uint8Array(0),
		owner: new LegacyPublicKey(SYSTEM_PROGRAM_ID),
		executable: false,
		rentEpoch: 0n,
	});
}

// ─── SECTION 9: Test Environment Setup ───────────────────────────────

export interface TestEnv {
	svm: LiteSVM;
	admin: KeyPairSigner;
	treasury: KeyPairSigner;
	challenger: KeyPairSigner;
	opponent: KeyPairSigner;
	challengerBagMint: KeyPairSigner;
}

export interface SharedSvmEnv {
	svm: LiteSVM;
	admin: KeyPairSigner;
	treasury: KeyPairSigner;
}

/** Create a fresh SVM with funded admin + treasury (no config initialized). */
export async function createSharedEnv(): Promise<SharedSvmEnv> {
	const svm = createSVM();
	const admin = await createTestSigner();
	const treasury = await createTestSigner();
	fundAccount(svm, admin.address);
	fundAccount(svm, treasury.address);
	return { svm, admin, treasury };
}

/** Initialize config + register game type 0 on a shared env. */
export async function initSharedEnv(shared: SharedSvmEnv): Promise<void> {
	const ix = await buildInitializeIx(
		shared.admin.address,
		shared.treasury.address,
		DEFAULT_FEE_BPS,
		DEFAULT_MINT_PRICE,
		DEFAULT_INITIAL_USES,
		DEFAULT_WAGER_EXPIRY,
		DEFAULT_VRF_TIMEOUT,
	);
	await sendAndExpectSuccess(
		shared.svm,
		[ix],
		[shared.admin],
		shared.admin.address,
	);
	const gtIx = await buildRegisterGameTypeIx(
		shared.admin.address,
		0,
		"High/Low",
		true,
	);
	await sendAndExpectSuccess(
		shared.svm,
		[gtIx],
		[shared.admin],
		shared.admin.address,
	);
}

/** Create fresh keypairs on an existing shared SVM (no config init). */
export async function setupTestEnvFrom(shared: SharedSvmEnv): Promise<TestEnv> {
	const challenger = await createTestSigner();
	const opponent = await createTestSigner();
	const challengerBagMint = await createTestSigner();
	fundAccount(shared.svm, challenger.address);
	fundAccount(shared.svm, opponent.address);
	return {
		svm: shared.svm,
		admin: shared.admin,
		treasury: shared.treasury,
		challenger,
		opponent,
		challengerBagMint,
	};
}

/** Create fresh keypairs + dice bag on an existing shared SVM. */
export async function setupFullEnvFrom(shared: SharedSvmEnv): Promise<TestEnv> {
	const env = await setupTestEnvFrom(shared);
	await writeDiceBagAccount(
		env.svm,
		env.challengerBagMint.address,
		env.challenger.address,
		DEFAULT_INITIAL_USES,
	);
	return env;
}

// Legacy helpers (create a new SVM per call) — kept for init tests that need a pristine SVM.
export async function setupTestEnv(): Promise<TestEnv> {
	const svm = createSVM();
	const admin = await createTestSigner();
	const treasury = await createTestSigner();
	const challenger = await createTestSigner();
	const opponent = await createTestSigner();
	const challengerBagMint = await createTestSigner();

	fundAccount(svm, admin.address);
	fundAccount(svm, treasury.address);
	fundAccount(svm, challenger.address);
	fundAccount(svm, opponent.address);

	return { svm, admin, treasury, challenger, opponent, challengerBagMint };
}

export async function initializeConfig(env: TestEnv): Promise<void> {
	const ix = await buildInitializeIx(
		env.admin.address,
		env.treasury.address,
		DEFAULT_FEE_BPS,
		DEFAULT_MINT_PRICE,
		DEFAULT_INITIAL_USES,
		DEFAULT_WAGER_EXPIRY,
		DEFAULT_VRF_TIMEOUT,
	);
	await sendAndExpectSuccess(env.svm, [ix], [env.admin], env.admin.address);
}

export async function registerHighLowGameType(env: TestEnv): Promise<void> {
	const ix = await buildRegisterGameTypeIx(
		env.admin.address,
		0,
		"High/Low",
		true,
	);
	await sendAndExpectSuccess(env.svm, [ix], [env.admin], env.admin.address);
}

export async function setupFullEnv(): Promise<TestEnv> {
	const env = await setupTestEnv();
	await initializeConfig(env);
	await registerHighLowGameType(env);
	await writeDiceBagAccount(
		env.svm,
		env.challengerBagMint.address,
		env.challenger.address,
		DEFAULT_INITIAL_USES,
	);
	return env;
}

// ─── SECTION 10: Utility Functions ───────────────────────────────────

export function advanceClock(svm: LiteSVM, seconds: number): void {
	const clock = svm.getClock();
	clock.unixTimestamp = clock.unixTimestamp + BigInt(seconds);
	clock.slot = clock.slot + BigInt(seconds);
	svm.setClock(clock);
}

export function getCustomErrorCode(error: any): number | null {
	try {
		if (error && typeof error.err === "function") {
			const inner = error.err();
			if (inner && typeof inner.err === "function") {
				const custom = inner.err();
				if (custom && "code" in custom) {
					return custom.code;
				}
			}
		}
		if (error && "code" in error) {
			return error.code;
		}
		if (error && typeof error.err === "function") {
			const custom = error.err();
			if (custom && "code" in custom) {
				return custom.code;
			}
		}
	} catch {
		// ignore
	}
	return null;
}

// Error codes from the program (6000-based)
export const ErrorCode = {
	GamePaused: 6000,
	SelfWager: 6001,
	BagExhausted: 6002,
	BagNotOwned: 6003,
	InvalidAmount: 6004,
	GameTypeDisabled: 6005,
	InvalidChoice: 6006,
	WagerInProgress: 6007,
	InvalidWagerStatus: 6008,
	WagerExpired: 6009,
	WagerNotExpired: 6010,
	VrfNotTimedOut: 6011,
	EscrowBalanceMismatch: 6012,
	Overflow: 6013,
	FeeTooHigh: 6014,
	InvalidInitialUses: 6015,
	InvalidTimeoutConfig: 6016,
	Unauthorized: 6017,
	DuplicateAccounts: 6018,
	InvalidGameTypeName: 6019,
} as const;
