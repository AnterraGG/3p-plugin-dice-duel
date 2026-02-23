import * as crypto from "crypto";
import * as fs from "fs";
/**
 * Full Dice Duel Game Test v2 — New program ID with high-priority VRF
 */
import {
	ComputeBudgetProgram,
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
	sendAndConfirmTransaction,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(
	"D8YzrLvAiwNmJF6gjAKLVQkqSNx5zD7TH7anqC52noof",
);
const VRF_PROGRAM_ID = new PublicKey(
	"Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
);
const DEFAULT_QUEUE = new PublicKey(
	"Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);
const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const SLOT_HASHES = new PublicKey(
	"SysvarS1otHashes111111111111111111111111111",
);
const TREASURY = new PublicKey("BLq7QBexFpPDg2WMu4JaL67X7SEdnyvXGtcoEvdncq4m");

function disc(name: string): Buffer {
	return Buffer.from(
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
function pda(seeds: Buffer[]): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}

async function main() {
	const conn = new Connection("https://api.devnet.solana.com", "confirmed");
	const adminKey = JSON.parse(
		fs.readFileSync("/home/node/.config/solana/id.json", "utf8"),
	);
	const admin = Keypair.fromSecretKey(Uint8Array.from(adminKey));
	const challenger = Keypair.generate();
	const opponent = Keypair.generate();

	console.log("🎲 DICE DUEL v2 — HIGH PRIORITY VRF TEST");
	console.log("═".repeat(60));
	console.log("Program:", PROGRAM_ID.toBase58());
	console.log("Admin:", admin.publicKey.toBase58());
	console.log(
		"Balance:",
		(await conn.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL,
		"SOL",
	);

	// ── Step 1: Initialize config ──
	console.log("\n── Step 1: Initialize config + game type ──");
	const [configPda] = pda([Buffer.from("config")]);

	// initialize(treasury: Pubkey, fee_bps: u16, mint_price: u64, initial_uses: u8, wager_expiry: i64, vrf_timeout: i64)
	const initBuf = Buffer.alloc(8 + 32 + 2 + 8 + 1 + 8 + 8);
	disc("initialize").copy(initBuf, 0);
	TREASURY.toBuffer().copy(initBuf, 8); // offset 8
	initBuf.writeUInt16LE(500, 40); // offset 40: fee_bps
	initBuf.writeBigUInt64LE(BigInt(50_000_000), 42); // offset 42: mint_price
	initBuf.writeUInt8(10, 50); // offset 50: initial_uses (u8!)
	initBuf.writeBigInt64LE(BigInt(600), 51); // offset 51: wager_expiry
	initBuf.writeBigInt64LE(BigInt(900), 59); // offset 59: vrf_timeout

	const initIx = new TransactionInstruction({
		programId: PROGRAM_ID,
		keys: [
			{ pubkey: admin.publicKey, isSigner: true, isWritable: true },
			{ pubkey: configPda, isSigner: false, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data: initBuf,
	});

	const configExists = await conn.getAccountInfo(configPda);
	if (!configExists) {
		const initSig = await sendAndConfirmTransaction(
			conn,
			new Transaction().add(initIx),
			[admin],
		);
		console.log("✅ Config initialized:", initSig);
	} else {
		console.log("✅ Config already exists, skipping");
	}

	// Register game type 0 (high/low)
	const [gameTypePda] = pda([Buffer.from("game_type"), Buffer.from([0])]);
	// register_game_type(id: u8, name: String, enabled: bool)
	const gameName = "high_low";
	const regBuf = Buffer.alloc(8 + 1 + 4 + gameName.length + 1);
	disc("register_game_type").copy(regBuf, 0);
	regBuf.writeUInt8(0, 8); // id
	regBuf.writeUInt32LE(gameName.length, 9); // string len
	regBuf.write(gameName, 13); // string
	regBuf.writeUInt8(1, 13 + gameName.length); // enabled = true

	const regIx = new TransactionInstruction({
		programId: PROGRAM_ID,
		keys: [
			{ pubkey: admin.publicKey, isSigner: true, isWritable: true },
			{ pubkey: gameTypePda, isSigner: false, isWritable: true },
			{ pubkey: configPda, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data: regBuf,
	});

	const gameTypeExists = await conn.getAccountInfo(gameTypePda);
	if (!gameTypeExists) {
		const regSig = await sendAndConfirmTransaction(
			conn,
			new Transaction().add(regIx),
			[admin],
		);
		console.log("✅ Game type registered:", regSig);
	} else {
		console.log("✅ Game type already exists, skipping");
	}

	// ── Step 2: Fund wallets ──
	console.log("\n── Step 2: Fund wallets ──");
	const fundTx = new Transaction().add(
		SystemProgram.transfer({
			fromPubkey: admin.publicKey,
			toPubkey: challenger.publicKey,
			lamports: 0.5 * LAMPORTS_PER_SOL,
		}),
		SystemProgram.transfer({
			fromPubkey: admin.publicKey,
			toPubkey: opponent.publicKey,
			lamports: 0.5 * LAMPORTS_PER_SOL,
		}),
	);
	await sendAndConfirmTransaction(conn, fundTx, [admin]);
	console.log("✅ Funded 0.5 SOL each");

	// ── Step 3: Mint dice bags ──
	console.log("\n── Step 3: Mint dice bags ──");
	const mintC = Keypair.generate();
	const [challengerBagPda] = pda([
		Buffer.from("dice_bag"),
		mintC.publicKey.toBuffer(),
	]);

	const mintCIx = new TransactionInstruction({
		programId: PROGRAM_ID,
		keys: [
			{ pubkey: challenger.publicKey, isSigner: true, isWritable: true },
			{ pubkey: configPda, isSigner: false, isWritable: true },
			{ pubkey: mintC.publicKey, isSigner: true, isWritable: true },
			{ pubkey: challengerBagPda, isSigner: false, isWritable: true },
			{ pubkey: TREASURY, isSigner: false, isWritable: true },
			{ pubkey: MPL_CORE, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data: disc("mint_dice_bag"),
	});
	await sendAndConfirmTransaction(conn, new Transaction().add(mintCIx), [
		challenger,
		mintC,
	]);
	console.log("✅ Challenger bag minted");

	// ── Step 4: Initiate wager ──
	console.log("\n── Step 4: Initiate wager (0.1 SOL) ──");
	const wagerAmount = BigInt(0.1 * LAMPORTS_PER_SOL);
	const [wagerPda] = pda([
		Buffer.from("wager"),
		challenger.publicKey.toBuffer(),
	]);
	const [escrowPda] = pda([Buffer.from("escrow"), wagerPda.toBuffer()]);

	const initWData = Buffer.alloc(8 + 32 + 8 + 1 + 1);
	disc("initiate_wager").copy(initWData, 0);
	opponent.publicKey.toBuffer().copy(initWData, 8);
	initWData.writeBigUInt64LE(wagerAmount, 40);
	initWData.writeUInt8(0, 48); // game_type = high_low
	initWData.writeUInt8(1, 49); // challenger_choice = High

	const initWIx = new TransactionInstruction({
		programId: PROGRAM_ID,
		keys: [
			{ pubkey: challenger.publicKey, isSigner: true, isWritable: true },
			{ pubkey: challengerBagPda, isSigner: false, isWritable: true },
			{ pubkey: wagerPda, isSigner: false, isWritable: true },
			{ pubkey: escrowPda, isSigner: false, isWritable: true },
			{ pubkey: configPda, isSigner: false, isWritable: false },
			{ pubkey: gameTypePda, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data: initWData,
	});
	await sendAndConfirmTransaction(conn, new Transaction().add(initWIx), [
		challenger,
	]);
	console.log("✅ Wager initiated");

	// ── Step 5: Accept wager (VRF request) ──
	console.log("\n── Step 5: Accept wager (HIGH PRIORITY VRF) ──");
	const [challengerStatsPda] = pda([
		Buffer.from("stats"),
		challenger.publicKey.toBuffer(),
	]);
	const [opponentStatsPda] = pda([
		Buffer.from("stats"),
		opponent.publicKey.toBuffer(),
	]);
	const [programIdentityPda] = PublicKey.findProgramAddressSync(
		[Buffer.from("identity")],
		PROGRAM_ID,
	);

	const acceptIx = new TransactionInstruction({
		programId: PROGRAM_ID,
		keys: [
			{ pubkey: opponent.publicKey, isSigner: true, isWritable: true },
			{ pubkey: wagerPda, isSigner: false, isWritable: true },
			{ pubkey: challenger.publicKey, isSigner: false, isWritable: false },
			{ pubkey: challengerBagPda, isSigner: false, isWritable: true },
			{ pubkey: escrowPda, isSigner: false, isWritable: true },
			{ pubkey: configPda, isSigner: false, isWritable: false },
			{ pubkey: challengerStatsPda, isSigner: false, isWritable: true },
			{ pubkey: opponentStatsPda, isSigner: false, isWritable: true },
			{ pubkey: DEFAULT_QUEUE, isSigner: false, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: programIdentityPda, isSigner: false, isWritable: false },
			{ pubkey: VRF_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: SLOT_HASHES, isSigner: false, isWritable: false },
		],
		data: disc("accept_wager"),
	});

	const acceptTx = new Transaction().add(
		ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
		acceptIx,
	);

	const acceptTime = Date.now();
	const acceptSig = await sendAndConfirmTransaction(conn, acceptTx, [opponent]);
	console.log("✅ Wager accepted! TX:", acceptSig);

	// ── Step 6: Poll for settlement ──
	console.log("\n── Step 6: Polling for VRF fulfillment ──");
	const maxWaitMs = 5 * 60 * 1000;

	while (Date.now() - acceptTime < maxWaitMs) {
		const wagerAccount = await conn.getAccountInfo(wagerPda);
		const elapsed = Math.round((Date.now() - acceptTime) / 1000);

		if (!wagerAccount) {
			const vrfTime = Date.now() - acceptTime;
			console.log(
				`  [${elapsed}s] Wager account CLOSED — game settled in ${vrfTime}ms!`,
			);
			break;
		}

		console.log(`  [${elapsed}s] Waiting...`);
		await new Promise((r) => setTimeout(r, 3_000)); // poll every 3s for speed measurement
	}

	// ── Step 7: Check results ──
	console.log("\n── Step 7: Verify results ──");
	const challengerBal = await conn.getBalance(challenger.publicKey);
	const opponentBal = await conn.getBalance(opponent.publicKey);
	const escrowBal = await conn.getBalance(escrowPda);
	const treasuryBal = await conn.getBalance(TREASURY);

	console.log("Challenger balance:", challengerBal / LAMPORTS_PER_SOL, "SOL");
	console.log("Opponent balance:", opponentBal / LAMPORTS_PER_SOL, "SOL");
	console.log(
		"Escrow balance:",
		escrowBal / LAMPORTS_PER_SOL,
		"SOL (should be 0)",
	);

	// Find the consume_randomness tx
	const sigs = await conn.getSignaturesForAddress(wagerPda, { limit: 5 });
	for (const sig of sigs) {
		const tx = await conn.getTransaction(sig.signature, {
			maxSupportedTransactionVersion: 0,
		});
		if (!tx?.meta?.logMessages) continue;
		const logs = tx.meta.logMessages;

		const eventLogs = logs.filter((l) => l.startsWith("Program data:"));
		for (const el of eventLogs) {
			const buf = Buffer.from(el.replace("Program data: ", ""), "base64");
			const discHex = buf.subarray(0, 8).toString("hex");

			if (discHex === eventDisc("WagerResolved")) {
				const data = buf.subarray(8);
				const challengerKey = new PublicKey(data.subarray(0, 32)).toBase58();
				const opponentKey = new PublicKey(data.subarray(32, 64)).toBase58();
				const winnerKey = new PublicKey(data.subarray(64, 96)).toBase58();
				const amount = data.readBigUInt64LE(96);
				const vrfResult = data.readUInt8(104);
				const fee = data.readBigUInt64LE(105);
				const payout = data.readBigUInt64LE(113);

				const winnerLabel =
					winnerKey === challengerKey ? "CHALLENGER" : "OPPONENT";
				const highLow = vrfResult >= 50 ? "HIGH" : "LOW";

				console.log(`\n🎲 GAME RESULT:`);
				console.log(`   VRF Roll: ${vrfResult} (${highLow})`);
				console.log(`   Challenger chose: HIGH`);
				console.log(`   Winner: ${winnerLabel}`);
				console.log(`   Wager: ${Number(amount) / LAMPORTS_PER_SOL} SOL`);
				console.log(`   Fee: ${Number(fee) / LAMPORTS_PER_SOL} SOL`);
				console.log(`   Payout: ${Number(payout) / LAMPORTS_PER_SOL} SOL`);
			}
		}
	}

	// Check stats
	const cStats = await conn.getAccountInfo(challengerStatsPda);
	const oStats = await conn.getAccountInfo(opponentStatsPda);
	if (cStats) {
		const d = cStats.data;
		console.log(
			`\nChallenger stats: ${d.readUInt32LE(40)} games, ${d.readUInt32LE(44)}W/${d.readUInt32LE(48)}L`,
		);
	}
	if (oStats) {
		const d = oStats.data;
		console.log(
			`Opponent stats: ${d.readUInt32LE(40)} games, ${d.readUInt32LE(44)}W/${d.readUInt32LE(48)}L`,
		);
	}

	console.log("\n" + "═".repeat(60));
	console.log("🎲 FULL GAME TEST COMPLETE");
}

main().catch(console.error);
