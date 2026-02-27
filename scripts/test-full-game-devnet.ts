import * as crypto from "crypto";
import * as fs from "fs";
/**
 * Full Dice Duel Game Test — Devnet
 *
 * Tests: mint bags → initiate wager → accept wager → VRF fulfillment → verify settlement
 * Checks: escrow balances, winner determination, fee collection, account closure, tx logs
 */
import {
	AccountRole,
	type Address,
	type IInstruction,
	type TransactionSigner,
	address,
	appendTransactionMessageInstruction,
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

async function pdaAddr(seeds: Uint8Array[]): Promise<Address> {
	const [addr] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds,
	});
	return addr;
}

// Anchor event discriminator: sha256("event:EventName")[0..8]
function eventDisc(name: string): string {
	return crypto
		.createHash("sha256")
		.update(`event:${name}`)
		.digest()
		.subarray(0, 8)
		.toString("hex");
}

/** Build, sign, and send a transaction. Returns the signature. */
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
	const wagerAmountLamports = LAMPORTS_PER_SOL / 10n; // 0.1 SOL

	console.log("🎲 FULL DICE DUEL GAME TEST");
	console.log("═".repeat(60));
	console.log("Admin:", admin.address);
	console.log("Challenger:", challenger.address);
	console.log("Opponent:", opponent.address);
	console.log(
		"Wager:",
		Number(wagerAmountLamports) / Number(LAMPORTS_PER_SOL),
		"SOL",
	);

	// ── Fund wallets ──
	console.log("\n── Step 1: Fund wallets ──");
	const fundAmount = (LAMPORTS_PER_SOL * 3n) / 2n; // 1.5 SOL

	const fundIxs: IInstruction[] = [
		{
			programAddress: SYSTEM_PROGRAM_ID,
			accounts: [
				{
					address: admin.address,
					role: AccountRole.WRITABLE_SIGNER,
					signer: admin,
				},
				{ address: challenger.address, role: AccountRole.WRITABLE },
			],
			data: (() => {
				// SystemProgram.transfer instruction: index 2 (u32 LE) + lamports (u64 LE)
				const buf = Buffer.alloc(12);
				buf.writeUInt32LE(2, 0);
				buf.writeBigUInt64LE(fundAmount, 4);
				return new Uint8Array(buf);
			})(),
		},
		{
			programAddress: SYSTEM_PROGRAM_ID,
			accounts: [
				{
					address: admin.address,
					role: AccountRole.WRITABLE_SIGNER,
					signer: admin,
				},
				{ address: opponent.address, role: AccountRole.WRITABLE },
			],
			data: (() => {
				const buf = Buffer.alloc(12);
				buf.writeUInt32LE(2, 0);
				buf.writeBigUInt64LE(fundAmount, 4);
				return new Uint8Array(buf);
			})(),
		},
	];
	await buildAndSend(rpc, sendAndConfirm, fundIxs, admin);
	console.log("✅ Funded 1.5 SOL each");

	// ── PDAs ──
	const configPda = await pdaAddr([utf8.encode("config")]);
	const gameTypePda = await pdaAddr([
		utf8.encode("game_type"),
		new Uint8Array([0]),
	]);
	const wagerPda = await pdaAddr([
		utf8.encode("wager"),
		addrEncoder.encode(challenger.address),
	]);
	const escrowPda = await pdaAddr([
		utf8.encode("escrow"),
		addrEncoder.encode(wagerPda),
	]);
	const challengerStatsPda = await pdaAddr([
		utf8.encode("stats"),
		addrEncoder.encode(challenger.address),
	]);
	const opponentStatsPda = await pdaAddr([
		utf8.encode("stats"),
		addrEncoder.encode(opponent.address),
	]);
	const [programIdentityPda] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [utf8.encode("identity")],
	});

	// ── Mint dice bags ──
	console.log("\n── Step 2: Mint dice bags ──");

	const mintChallenger = await generateKeyPairSigner();
	const challengerBagPda = await pdaAddr([
		utf8.encode("dice_bag"),
		addrEncoder.encode(mintChallenger.address),
	]);

	const mintOpponent = await generateKeyPairSigner();
	const opponentBagPda = await pdaAddr([
		utf8.encode("dice_bag"),
		addrEncoder.encode(mintOpponent.address),
	]);

	const mintChallengerIx: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: challenger.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: challenger,
			},
			{ address: configPda, role: AccountRole.WRITABLE },
			{
				address: mintChallenger.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: mintChallenger,
			},
			{ address: challengerBagPda, role: AccountRole.WRITABLE },
			{ address: TREASURY, role: AccountRole.WRITABLE },
			{ address: MPL_CORE, role: AccountRole.READONLY },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
		],
		data: disc("mint_dice_bag"),
	};
	await buildAndSend(rpc, sendAndConfirm, [mintChallengerIx], challenger);
	console.log("✅ Challenger bag minted:", challengerBagPda);

	const mintOpponentIx: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: opponent.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: opponent,
			},
			{ address: configPda, role: AccountRole.WRITABLE },
			{
				address: mintOpponent.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: mintOpponent,
			},
			{ address: opponentBagPda, role: AccountRole.WRITABLE },
			{ address: TREASURY, role: AccountRole.WRITABLE },
			{ address: MPL_CORE, role: AccountRole.READONLY },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
		],
		data: disc("mint_dice_bag"),
	};
	await buildAndSend(rpc, sendAndConfirm, [mintOpponentIx], opponent);
	console.log("✅ Opponent bag minted:", opponentBagPda);

	// ── Record pre-wager balances ──
	const { value: challengerBalBefore } = await rpc
		.getBalance(challenger.address)
		.send();
	const { value: opponentBalBefore } = await rpc
		.getBalance(opponent.address)
		.send();
	const { value: treasuryBalBefore } = await rpc.getBalance(TREASURY).send();

	// ── Initiate wager ──
	console.log("\n── Step 3: Initiate wager ──");
	const initData = Buffer.alloc(8 + 32 + 8 + 1 + 1);
	disc("initiate_wager").forEach((b, i) => (initData[i] = b));
	Buffer.from(addrEncoder.encode(opponent.address)).copy(initData, 8);
	initData.writeBigUInt64LE(wagerAmountLamports, 40);
	initData.writeUInt8(0, 48); // game_type = high_low
	initData.writeUInt8(1, 49); // challenger_choice = High (>= 50 wins)

	const initIx: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: challenger.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: challenger,
			},
			{ address: challengerBagPda, role: AccountRole.WRITABLE },
			{ address: wagerPda, role: AccountRole.WRITABLE },
			{ address: escrowPda, role: AccountRole.WRITABLE },
			{ address: configPda, role: AccountRole.READONLY },
			{ address: gameTypePda, role: AccountRole.READONLY },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
		],
		data: new Uint8Array(initData),
	};
	const initSig = await buildAndSend(rpc, sendAndConfirm, [initIx], challenger);
	console.log("✅ Wager initiated, tx:", initSig);

	const { value: escrowBal } = await rpc.getBalance(escrowPda).send();
	console.log(
		"   Escrow balance:",
		Number(escrowBal) / Number(LAMPORTS_PER_SOL),
		"SOL",
	);

	// ── Accept wager (triggers VRF) ──
	console.log("\n── Step 4: Accept wager (VRF request) ──");

	// Compute budget instruction: SetComputeUnitLimit(400_000)
	const computeBudgetProgramId = address(
		"ComputeBudget111111111111111111111111111111",
	);
	const cuLimitData = Buffer.alloc(5);
	cuLimitData.writeUInt8(2, 0); // SetComputeUnitLimit instruction index
	cuLimitData.writeUInt32LE(400_000, 1);

	const computeBudgetIx: IInstruction = {
		programAddress: computeBudgetProgramId,
		accounts: [],
		data: new Uint8Array(cuLimitData),
	};

	const acceptIx: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: opponent.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: opponent,
			},
			{ address: wagerPda, role: AccountRole.WRITABLE },
			{ address: challenger.address, role: AccountRole.READONLY },
			{ address: challengerBagPda, role: AccountRole.WRITABLE },
			{ address: escrowPda, role: AccountRole.WRITABLE },
			{ address: configPda, role: AccountRole.READONLY },
			{ address: challengerStatsPda, role: AccountRole.WRITABLE },
			{ address: opponentStatsPda, role: AccountRole.WRITABLE },
			{ address: DEFAULT_QUEUE, role: AccountRole.WRITABLE },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
			{ address: programIdentityPda, role: AccountRole.READONLY },
			{ address: VRF_PROGRAM_ID, role: AccountRole.READONLY },
			{ address: SLOT_HASHES, role: AccountRole.READONLY },
		],
		data: disc("accept_wager"),
	};

	const acceptSig = await buildAndSend(
		rpc,
		sendAndConfirm,
		[computeBudgetIx, acceptIx],
		opponent,
	);
	console.log("✅ Wager accepted! VRF requested. TX:", acceptSig);

	// ── Poll for settlement ──
	console.log("\n── Step 5: Polling for VRF fulfillment ──");
	const startTime = Date.now();
	const maxWaitMs = 5 * 60 * 1000;
	let settled = false;

	while (Date.now() - startTime < maxWaitMs) {
		const { value: wagerAccount } = await rpc
			.getAccountInfo(wagerPda, { encoding: "base64" })
			.send();
		const elapsed = Math.round((Date.now() - startTime) / 1000);

		if (!wagerAccount) {
			// Account closed = wager settled (consume_randomness closes it)
			console.log(`  [${elapsed}s] Wager account CLOSED — game settled!`);
			settled = true;
			break;
		}

		console.log(
			`  [${elapsed}s] Wager account still exists (${(wagerAccount.data[0] as string).length} b64 chars) — waiting...`,
		);
		await new Promise((r) => setTimeout(r, 10_000));
	}

	if (!settled) {
		console.log(
			"\n❌ VRF not fulfilled after 5 minutes. Oracle may still be down.",
		);
		return;
	}

	// ── Verify results ──
	console.log("\n── Step 6: Verify results ──");

	const { value: challengerBalAfter } = await rpc
		.getBalance(challenger.address)
		.send();
	const { value: opponentBalAfter } = await rpc
		.getBalance(opponent.address)
		.send();
	const { value: treasuryBalAfter } = await rpc.getBalance(TREASURY).send();
	const { value: escrowBalAfter } = await rpc.getBalance(escrowPda).send();

	console.log("\n📊 Balance Changes:");
	console.log(
		"   Challenger:",
		(
			Number(challengerBalAfter - challengerBalBefore) /
			Number(LAMPORTS_PER_SOL)
		).toFixed(6),
		"SOL",
	);
	console.log(
		"   Opponent:",
		(
			Number(opponentBalAfter - opponentBalBefore) / Number(LAMPORTS_PER_SOL)
		).toFixed(6),
		"SOL",
	);
	console.log(
		"   Treasury:",
		(
			Number(treasuryBalAfter - treasuryBalBefore) / Number(LAMPORTS_PER_SOL)
		).toFixed(6),
		"SOL",
	);
	console.log(
		"   Escrow:",
		Number(escrowBalAfter) / Number(LAMPORTS_PER_SOL),
		"SOL (should be 0)",
	);

	// ── Find the consume_randomness tx ──
	console.log("\n── Step 7: Find VRF callback transaction ──");
	// Look for recent txs on the wager PDA — use legacy getSignaturesForAddress via fetch
	const sigs = await rpc.getSignaturesForAddress(wagerPda, { limit: 5 }).send();
	console.log(`   Found ${sigs.length} transactions on wager PDA:`);

	for (const sigInfo of sigs) {
		const tx = await rpc
			.getTransaction(sigInfo.signature, {
				maxSupportedTransactionVersion: 0,
				encoding: "json",
			})
			.send();
		if (!tx?.meta?.logMessages) continue;

		const logs = tx.meta.logMessages;
		const isConsumeRandomness = logs.some(
			(l) =>
				l.includes("consume_randomness") || l.includes("ConsumeRandomness"),
		);
		const isAcceptWager = logs.some((l) => l.includes("AcceptWager"));
		const isInitiateWager = logs.some((l) => l.includes("InitiateWager"));

		let label = "unknown";
		if (isConsumeRandomness) label = "🎯 CONSUME_RANDOMNESS (VRF callback)";
		else if (isAcceptWager) label = "accept_wager";
		else if (isInitiateWager) label = "initiate_wager";

		console.log(`\n   TX: ${sigInfo.signature}`);
		console.log(`   Type: ${label}`);

		if (isConsumeRandomness) {
			console.log("   Logs:");
			for (const log of logs) {
				if (log.includes("Program log:") || log.includes("data:")) {
					console.log("     ", log);
				}
			}

			// Check for Anchor events in logs
			const eventLogs = logs.filter((l) => l.startsWith("Program data:"));
			if (eventLogs.length > 0) {
				console.log("\n   📡 Anchor Events emitted:");
				for (const el of eventLogs) {
					const b64Data = el.replace("Program data: ", "");
					const buf = Buffer.from(b64Data, "base64");
					const discHex = buf.subarray(0, 8).toString("hex");

					const WAGER_RESOLVED_DISC = eventDisc("WagerResolved");
					if (discHex === WAGER_RESOLVED_DISC) {
						// Parse WagerResolved event
						const data = buf.subarray(8);
						const challengerKey = address(
							base58Decoder.decode(data.subarray(0, 32)),
						);
						const opponentKey = address(
							base58Decoder.decode(data.subarray(32, 64)),
						);
						const winnerKey = address(
							base58Decoder.decode(data.subarray(64, 96)),
						);
						const amount = data.readBigUInt64LE(96);
						const vrfResult = data.readUInt8(104);
						const fee = data.readBigUInt64LE(105);
						const payout = data.readBigUInt64LE(113);

						const winnerLabel =
							winnerKey === challengerKey ? "CHALLENGER" : "OPPONENT";
						const highLowResult = vrfResult >= 50 ? "HIGH" : "LOW";

						console.log(`\n   🎲 GAME RESULT:`);
						console.log(`      VRF Roll: ${vrfResult} (${highLowResult})`);
						console.log(`      Challenger chose: HIGH`);
						console.log(
							`      Winner: ${winnerLabel} (${winnerKey.slice(0, 8)}...)`,
						);
						console.log(
							`      Wager: ${Number(amount) / Number(LAMPORTS_PER_SOL)} SOL`,
						);
						console.log(
							`      Fee: ${Number(fee) / Number(LAMPORTS_PER_SOL)} SOL (${((Number(fee) * 100) / Number(amount * 2n)).toFixed(1)}%)`,
						);
						console.log(
							`      Payout: ${Number(payout) / Number(LAMPORTS_PER_SOL)} SOL`,
						);
					} else {
						console.log(`      Unknown event disc: ${discHex}`);
					}
				}
			}
		}
	}

	// ── Check stats ──
	console.log("\n── Step 8: Check player stats ──");
	const { value: challengerStatsAccount } = await rpc
		.getAccountInfo(challengerStatsPda, { encoding: "base64" })
		.send();
	const { value: opponentStatsAccount } = await rpc
		.getAccountInfo(opponentStatsPda, { encoding: "base64" })
		.send();

	if (challengerStatsAccount) {
		const d = Buffer.from(challengerStatsAccount.data[0] as string, "base64");
		// Skip 8-byte discriminator, then: player(32), total_games(u32), wins(u32), losses(u32)
		const totalGames = d.readUInt32LE(40);
		const wins = d.readUInt32LE(44);
		const losses = d.readUInt32LE(48);
		console.log(
			`   Challenger stats: ${totalGames} games, ${wins}W/${losses}L`,
		);
	}
	if (opponentStatsAccount) {
		const d = Buffer.from(opponentStatsAccount.data[0] as string, "base64");
		const totalGames = d.readUInt32LE(40);
		const wins = d.readUInt32LE(44);
		const losses = d.readUInt32LE(48);
		console.log(`   Opponent stats: ${totalGames} games, ${wins}W/${losses}L`);
	}

	// ── Check dice bag uses ──
	console.log("\n── Step 9: Check dice bag uses ──");
	const { value: challengerBag } = await rpc
		.getAccountInfo(challengerBagPda, { encoding: "base64" })
		.send();
	if (challengerBag) {
		const d = Buffer.from(challengerBag.data[0] as string, "base64");
		// disc(8) + owner(32) + mint(32) + uses_remaining(u32) + total_games(u32)
		const usesRemaining = d.readUInt32LE(72);
		const totalGames = d.readUInt32LE(76);
		console.log(
			`   Challenger bag: ${usesRemaining} uses remaining, ${totalGames} games played`,
		);
	}

	console.log("\n" + "═".repeat(60));
	console.log("🎲 FULL GAME TEST COMPLETE");
	console.log("═".repeat(60));
}

main().catch(console.error);
