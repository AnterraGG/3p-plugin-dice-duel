import * as crypto from "crypto";
import * as fs from "fs";
/**
 * Nonce-based Dice Duel E2E Test — Devnet
 *
 * Tests the full v5-nonce flow:
 *   mint bags → initiate (nonce=0) → accept (VRF) → poll for resolve → claim_winnings
 *
 * Uses real MagicBlock VRF on devnet.
 */
import {
	AccountRole,
	type Address,
	type IInstruction,
	type TransactionSigner,
	address,
	appendTransactionMessageInstructions,
	createKeyPairSignerFromBytes,
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	createTransactionMessage,
	generateKeyPairSigner,
	getAddressEncoder,
	getBase58Decoder,
	getProgramDerivedAddress,
	getSignatureFromTransaction,
	getUtf8Encoder,
	sendAndConfirmTransactionFactory,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
} from "@solana/kit";
import { DICE_DUEL_PROGRAM_ID } from "../shared/programs";

const PROGRAM_ID = address(DICE_DUEL_PROGRAM_ID);
const VRF_PROGRAM_ID = address("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const DEFAULT_QUEUE = address("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
const MPL_CORE = address("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const SLOT_HASHES = address("SysvarS1otHashes111111111111111111111111111");
const TREASURY = address("BLq7QBexFpPDg2WMu4JaL67X7SEdnyvXGtcoEvdncq4m");
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_WS = "wss://api.devnet.solana.com";

const LAMPORTS_PER_SOL = 1_000_000_000n;
const utf8 = getUtf8Encoder();
const addrEncoder = getAddressEncoder();
const base58Decoder = getBase58Decoder();

function disc(name: string): Uint8Array {
	return new Uint8Array(
		crypto
			.createHash("sha256")
			.update(`global:${name}`)
			.digest()
			.subarray(0, 8),
	);
}

function eventDisc(name: string): string {
	return crypto
		.createHash("sha256")
		.update(`event:${name}`)
		.digest()
		.subarray(0, 8)
		.toString("hex");
}

async function pda(seeds: Uint8Array[]): Promise<Address> {
	const [addr] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds,
	});
	return addr;
}

async function vrfIdentityPda(): Promise<Address> {
	const [addr] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [utf8.encode("identity")],
	});
	return addr;
}

/** Nonce-aware wager PDA */
async function wagerPda(challenger: Address, nonce: bigint): Promise<Address> {
	const nonceBuf = new Uint8Array(8);
	new DataView(nonceBuf.buffer).setBigUint64(0, nonce, true);
	return pda([utf8.encode("wager"), addrEncoder.encode(challenger), nonceBuf]);
}

/** Escrow PDA (derived from wager PDA) */
async function escrowPda(wagerAddr: Address): Promise<Address> {
	return pda([utf8.encode("escrow"), addrEncoder.encode(wagerAddr)]);
}

async function buildAndSend(
	rpc: ReturnType<typeof createSolanaRpc>,
	sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
	instructions: IInstruction[],
	payer: TransactionSigner,
): Promise<string> {
	const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
	let msg = createTransactionMessage({ version: "legacy" });
	msg = setTransactionMessageFeePayer(payer.address, msg);
	msg = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg);
	msg = appendTransactionMessageInstructions(instructions, msg);
	const signed = await signTransactionMessageWithSigners(msg);
	await sendAndConfirm(signed, { commitment: "confirmed" });
	return getSignatureFromTransaction(signed);
}

/** Compute budget: set CU limit */
function computeUnitLimitIx(units: number): IInstruction {
	const data = Buffer.alloc(5);
	data.writeUInt8(2, 0);
	data.writeUInt32LE(units, 1);
	return {
		programAddress: address("ComputeBudget111111111111111111111111111111"),
		accounts: [],
		data: new Uint8Array(data),
	};
}

async function main() {
	const rpc = createSolanaRpc(DEVNET_RPC);
	const rpcSubscriptions = createSolanaRpcSubscriptions(DEVNET_WS);
	const sendAndConfirm = sendAndConfirmTransactionFactory({
		rpc,
		rpcSubscriptions,
	});

	const adminKey = new Uint8Array(
		JSON.parse(fs.readFileSync(process.env.SOLANA_KEYPAIR || (process.env.HOME + "/.config/solana/id.json"), "utf8")),
	);
	const admin = await createKeyPairSignerFromBytes(adminKey);

	const challenger = await generateKeyPairSigner();
	const opponent = await generateKeyPairSigner();
	const wagerAmount = LAMPORTS_PER_SOL / 100n; // 0.01 SOL (conserve devnet funds)

	console.log("🎲 NONCE-BASED DICE DUEL E2E TEST");
	console.log("═".repeat(60));
	console.log("Program:", PROGRAM_ID);
	console.log("Admin:", admin.address);
	console.log("Challenger:", challenger.address);
	console.log("Opponent:", opponent.address);
	console.log("Wager: 0.01 SOL");

	// ── Step 1: Fund wallets ──
	console.log("\n── Step 1: Fund wallets ──");
	const fundAmount = 80_000_000n; // 0.08 SOL each (mint=0.05, wager=0.01, rest=fees+rent)
	const fundIxs: IInstruction[] = [challenger, opponent].map((player) => ({
		programAddress: SYSTEM_PROGRAM_ID,
		accounts: [
			{
				address: admin.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: admin,
			},
			{ address: player.address, role: AccountRole.WRITABLE },
		],
		data: (() => {
			const buf = Buffer.alloc(12);
			buf.writeUInt32LE(2, 0);
			buf.writeBigUInt64LE(fundAmount, 4);
			return new Uint8Array(buf);
		})(),
	}));
	await buildAndSend(rpc, sendAndConfirm, fundIxs, admin);
	console.log("✅ Funded 2 SOL each");

	// ── Step 2: Mint dice bags ──
	console.log("\n── Step 2: Mint dice bags ──");
	const configPda = await pda([utf8.encode("config")]);
	const gameTypePda = await pda([
		utf8.encode("game_type"),
		new Uint8Array([0]),
	]);

	const mintChallenger = await generateKeyPairSigner();
	const challengerBagPda = await pda([
		utf8.encode("dice_bag"),
		addrEncoder.encode(mintChallenger.address),
	]);

	const mintOpponent = await generateKeyPairSigner();
	const opponentBagPda = await pda([
		utf8.encode("dice_bag"),
		addrEncoder.encode(mintOpponent.address),
	]);

	for (const [player, mint, bagPda, label] of [
		[challenger, mintChallenger, challengerBagPda, "Challenger"] as const,
		[opponent, mintOpponent, opponentBagPda, "Opponent"] as const,
	]) {
		const ix: IInstruction = {
			programAddress: PROGRAM_ID,
			accounts: [
				{
					address: player.address,
					role: AccountRole.WRITABLE_SIGNER,
					signer: player,
				},
				{ address: configPda, role: AccountRole.WRITABLE },
				{
					address: mint.address,
					role: AccountRole.WRITABLE_SIGNER,
					signer: mint,
				},
				{ address: bagPda, role: AccountRole.WRITABLE },
				{ address: TREASURY, role: AccountRole.WRITABLE },
				{ address: MPL_CORE, role: AccountRole.READONLY },
				{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
			],
			data: disc("mint_dice_bag"),
		};
		await buildAndSend(rpc, sendAndConfirm, [ix], player);
		console.log(`✅ ${label} bag minted: ${bagPda}`);
	}

	// ── Step 3: Initiate wager (nonce=0) ──
	console.log("\n── Step 3: Initiate wager (nonce=0) ──");
	const nonce = 0n;
	const wagerAddr = await wagerPda(challenger.address, nonce);
	const escrowAddr = await escrowPda(wagerAddr);
	const challengerStatsPda = await pda([
		utf8.encode("stats"),
		addrEncoder.encode(challenger.address),
	]);
	const opponentStatsPda = await pda([
		utf8.encode("stats"),
		addrEncoder.encode(opponent.address),
	]);

	const initData = Buffer.alloc(8 + 32 + 8 + 1 + 1);
	disc("initiate_wager").forEach((b, i) => (initData[i] = b));
	Buffer.from(addrEncoder.encode(opponent.address)).copy(initData, 8);
	initData.writeBigUInt64LE(wagerAmount, 40);
	initData.writeUInt8(0, 48); // game_type = high_low
	initData.writeUInt8(1, 49); // challenger_choice = High

	const initIx: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: challenger.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: challenger,
			},
			{ address: challengerBagPda, role: AccountRole.READONLY },
			{ address: challengerStatsPda, role: AccountRole.WRITABLE },
			{ address: wagerAddr, role: AccountRole.WRITABLE },
			{ address: escrowAddr, role: AccountRole.WRITABLE },
			{ address: configPda, role: AccountRole.READONLY },
			{ address: gameTypePda, role: AccountRole.READONLY },
			// Optional prev_wager/prev_escrow — pass program ID as sentinel for None
			{ address: PROGRAM_ID, role: AccountRole.READONLY },
			{ address: PROGRAM_ID, role: AccountRole.READONLY },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
		],
		data: new Uint8Array(initData),
	};
	const initSig = await buildAndSend(rpc, sendAndConfirm, [initIx], challenger);
	console.log("✅ Wager initiated:", initSig);

	const { value: escrowBal } = await rpc.getBalance(escrowAddr).send();
	console.log(`   Escrow: ${Number(escrowBal) / 1e9} SOL`);
	console.log(`   Wager PDA: ${wagerAddr}`);

	// Verify nonce in stats
	const { value: statsAcct } = await rpc
		.getAccountInfo(challengerStatsPda, { encoding: "base64" })
		.send();
	if (statsAcct) {
		const d = Buffer.from(statsAcct.data[0] as string, "base64");
		// disc(8) + player(32) + total_games(u32) + wins(u32) + losses(u32) + bump(u8) + wager_nonce(u64) + pending_nonce(Option<u64>)
		const wagerNonce = d.readBigUInt64LE(8 + 32 + 4 + 4 + 4 + 1);
		const hasPending = d.readUInt8(8 + 32 + 4 + 4 + 4 + 1 + 8);
		const pendingNonce = hasPending
			? d.readBigUInt64LE(8 + 32 + 4 + 4 + 4 + 1 + 8 + 1)
			: null;
		console.log(
			`   Stats: wager_nonce=${wagerNonce}, pending_nonce=${pendingNonce}`,
		);
	}

	// ── Step 4: Accept wager (triggers VRF) ──
	console.log("\n── Step 4: Accept wager (triggers VRF) ──");
	const identityPda = await vrfIdentityPda();

	const acceptIx: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: opponent.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: opponent,
			},
			{ address: wagerAddr, role: AccountRole.WRITABLE },
			{ address: challenger.address, role: AccountRole.READONLY },
			{ address: challengerBagPda, role: AccountRole.WRITABLE },
			{ address: escrowAddr, role: AccountRole.WRITABLE },
			{ address: configPda, role: AccountRole.READONLY },
			{ address: challengerStatsPda, role: AccountRole.WRITABLE },
			{ address: opponentStatsPda, role: AccountRole.WRITABLE },
			{ address: DEFAULT_QUEUE, role: AccountRole.WRITABLE },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
			// #[vrf] macro adds these:
			{ address: identityPda, role: AccountRole.WRITABLE },
			{ address: VRF_PROGRAM_ID, role: AccountRole.READONLY },
			{ address: SLOT_HASHES, role: AccountRole.READONLY },
		],
		data: disc("accept_wager"),
	};

	const acceptSig = await buildAndSend(
		rpc,
		sendAndConfirm,
		[computeUnitLimitIx(400_000), acceptIx],
		opponent,
	);
	console.log("✅ Wager accepted! VRF requested. TX:", acceptSig);

	// ── Step 5: Poll for VRF resolution ──
	console.log(
		"\n── Step 5: Polling for VRF resolve (consume_randomness_resolved) ──",
	);
	const startTime = Date.now();
	const maxWaitMs = 5 * 60 * 1000;
	let resolved = false;
	let winner: Address | null = null;

	while (Date.now() - startTime < maxWaitMs) {
		const { value: wagerAccount } = await rpc
			.getAccountInfo(wagerAddr, { encoding: "base64" })
			.send();
		const elapsed = Math.round((Date.now() - startTime) / 1000);

		if (!wagerAccount) {
			console.log(`  [${elapsed}s] Wager account gone (unexpected in v2 flow)`);
			break;
		}

		const d = Buffer.from(wagerAccount.data[0] as string, "base64");
		// Status offset: disc(8) + challenger(32) + opponent(32) + challenger_bag(32) + amount(8) + game_type(1) + challenger_choice(1) = 114
		const status = d.readUInt8(114);
		// Matches WagerStatus enum order in Rust
		const statusName =
			[
				"Pending",
				"Active",
				"ReadyToSettle",
				"Settled",
				"Cancelled",
				"Expired",
				"VrfTimeout",
				"Resolved",
			][status] ?? `Unknown(${status})`;

		if (status === 7) {
			// Resolved (index 7 in WagerStatus enum)
			console.log(`  [${elapsed}s] ✅ Wager RESOLVED!`);
			// Winner offset: status(1) + nonce(8) + vrf_requested_at(8) + vrf_result(Option<u8>) + vrf_fulfilled_at(Option<i64>) + winner(Option<Pubkey>)
			// Let me parse from the full struct instead
			resolved = true;

			// Parse winner from wager account
			// Struct layout (after 8-byte discriminator):
			// challenger: 32, opponent: 32, challenger_bag: 32, amount: 8, game_type: 1,
			// challenger_choice: 1, status: 1, nonce: 8, vrf_requested_at: 8,
			// vrf_fulfilled_at: Option<i64> (1+8), vrf_result: Option<u8> (1+1),
			// winner: Option<Pubkey> (1+32), created_at: 8, settled_at: Option<i64>,
			// threshold: 1, payout_multiplier_bps: 4, escrow_bump: 1, bump: 1
			let offset = 8 + 32 + 32 + 32 + 8 + 1 + 1 + 1 + 8 + 8; // = 131
			// vrf_fulfilled_at: Option<i64>
			const hasFulfilled = d.readUInt8(offset);
			offset += hasFulfilled ? 9 : 1;
			// vrf_result: Option<u8>
			const hasVrfResult = d.readUInt8(offset);
			const vrfResult = hasVrfResult ? d.readUInt8(offset + 1) : null;
			offset += hasVrfResult ? 2 : 1;
			// winner: Option<Pubkey>
			const hasWinner = d.readUInt8(offset);
			if (hasWinner) {
				const winnerBytes = d.subarray(offset + 1, offset + 33);
				winner = address(base58Decoder.decode(winnerBytes));
			}

			const winnerLabel =
				winner === challenger.address
					? "CHALLENGER"
					: winner === opponent.address
						? "OPPONENT"
						: "???";
			const resultLabel =
				vrfResult !== null ? (vrfResult >= 50 ? "HIGH" : "LOW") : "???";
			console.log(`      VRF Roll: ${vrfResult} (${resultLabel})`);
			console.log(`      Challenger chose: HIGH`);
			console.log(`      Winner: ${winnerLabel} (${winner?.slice(0, 12)}...)`);
			break;
		}

		console.log(`  [${elapsed}s] Status: ${statusName} — waiting...`);
		await new Promise((r) => setTimeout(r, 10_000));
	}

	if (!resolved) {
		console.log("\n❌ VRF not fulfilled after 5 minutes.");
		return;
	}

	// ── Step 6: Claim winnings ──
	console.log("\n── Step 6: Claim winnings ──");
	if (!winner) {
		console.log("❌ No winner determined, skipping claim.");
		return;
	}

	// Find the winner's signer
	const winnerSigner = winner === challenger.address ? challenger : opponent;
	const winnerLabel = winner === challenger.address ? "Challenger" : "Opponent";

	const claimIx: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: winnerSigner.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: winnerSigner,
			},
			{ address: wagerAddr, role: AccountRole.WRITABLE },
			{ address: escrowAddr, role: AccountRole.WRITABLE },
			{ address: challenger.address, role: AccountRole.WRITABLE },
			{ address: configPda, role: AccountRole.READONLY },
			{ address: TREASURY, role: AccountRole.WRITABLE },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
		],
		data: disc("claim_winnings"),
	};
	const claimSig = await buildAndSend(
		rpc,
		sendAndConfirm,
		[claimIx],
		winnerSigner,
	);
	console.log(`✅ ${winnerLabel} claimed winnings! TX: ${claimSig}`);

	// ── Step 7: Verify final state ──
	console.log("\n── Step 7: Verify final state ──");

	// Wager should be closed (claim_winnings has close = challenger)
	const { value: wagerFinal } = await rpc
		.getAccountInfo(wagerAddr, { encoding: "base64" })
		.send();
	console.log(
		`   Wager account: ${wagerFinal ? "STILL EXISTS (unexpected)" : "CLOSED ✅"}`,
	);

	// Escrow should be empty
	const { value: escrowFinal } = await rpc.getBalance(escrowAddr).send();
	console.log(
		`   Escrow balance: ${Number(escrowFinal) / 1e9} SOL ${escrowFinal === 0n ? "✅" : "⚠️"}`,
	);

	// Treasury should have fee
	const { value: treasuryBal } = await rpc.getBalance(TREASURY).send();
	console.log(`   Treasury: ${Number(treasuryBal) / 1e9} SOL`);

	// Check challenger stats
	const { value: finalStats } = await rpc
		.getAccountInfo(challengerStatsPda, { encoding: "base64" })
		.send();
	if (finalStats) {
		const d = Buffer.from(finalStats.data[0] as string, "base64");
		const totalGames = d.readUInt32LE(8 + 32);
		const wins = d.readUInt32LE(8 + 32 + 4);
		const losses = d.readUInt32LE(8 + 32 + 8);
		const wagerNonce = d.readBigUInt64LE(8 + 32 + 4 + 4 + 4 + 1);
		const hasPending = d.readUInt8(8 + 32 + 4 + 4 + 4 + 1 + 8);
		const pendingNonce = hasPending
			? d.readBigUInt64LE(8 + 32 + 4 + 4 + 4 + 1 + 8 + 1)
			: null;
		console.log(
			`   Challenger stats: ${totalGames} games, ${wins}W/${losses}L, nonce=${wagerNonce}, pending=${pendingNonce}`,
		);
	}

	const { value: opStats } = await rpc
		.getAccountInfo(opponentStatsPda, { encoding: "base64" })
		.send();
	if (opStats) {
		const d = Buffer.from(opStats.data[0] as string, "base64");
		const totalGames = d.readUInt32LE(8 + 32);
		const wins = d.readUInt32LE(8 + 32 + 4);
		const losses = d.readUInt32LE(8 + 32 + 8);
		console.log(`   Opponent stats: ${totalGames} games, ${wins}W/${losses}L`);
	}

	console.log("\n" + "═".repeat(60));
	console.log("🎲 NONCE E2E TEST COMPLETE");
	console.log("═".repeat(60));
}

main().catch((err) => {
	console.error("\n❌ Test failed:", err);
	process.exit(1);
});
