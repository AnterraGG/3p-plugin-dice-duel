import * as crypto from "crypto";
import * as fs from "fs";
/**
 * Test VRF v2 flow: consume_randomness_resolved → claim_winnings
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
	"7xfkbzEMJ31jPUqZoJ3EXrU72LiAw1wGKupGqmdZdoMM",
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
const RPC = process.env.HELIUS_RPC_URL || "https://api.devnet.solana.com";

function disc(name: string): Buffer {
	return Buffer.from(
		crypto
			.createHash("sha256")
			.update(`global:${name}`)
			.digest()
			.subarray(0, 8),
	);
}
function pda(seeds: Buffer[]): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}

async function main() {
	const conn = new Connection(RPC, "confirmed");
	const adminKey = JSON.parse(
		fs.readFileSync(
			process.env.ADMIN_KEYPAIR_PATH || (process.env.HOME + "/.config/solana/id.json"),
			"utf8",
		),
	);
	const admin = Keypair.fromSecretKey(Uint8Array.from(adminKey));

	const challenger = Keypair.generate();
	const opponent = Keypair.generate();
	const wagerLamports = 0.01 * LAMPORTS_PER_SOL;

	console.log("🎲 V2 RESOLVED CALLBACK TEST");
	console.log("═".repeat(60));
	console.log("Admin:", admin.publicKey.toBase58());
	console.log("Challenger:", challenger.publicKey.toBase58());
	console.log("Opponent:", opponent.publicKey.toBase58());
	console.log("Wager:", wagerLamports / LAMPORTS_PER_SOL, "SOL");

	// Fund wallets
	console.log("\n── Fund wallets ──");
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

	// PDAs
	const [configPda] = pda([Buffer.from("config")]);
	const [gameTypePda] = pda([Buffer.from("game_type"), Buffer.from([0])]);
	const [wagerPda] = pda([
		Buffer.from("wager"),
		challenger.publicKey.toBuffer(),
	]);
	const [escrowPda] = pda([Buffer.from("escrow"), wagerPda.toBuffer()]);
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

	// Mint challenger bag
	console.log("\n── Mint dice bags ──");
	const mintChallenger = Keypair.generate();
	const [challengerBagPda] = pda([
		Buffer.from("dice_bag"),
		mintChallenger.publicKey.toBuffer(),
	]);

	const mintChallengerIx = new TransactionInstruction({
		programId: PROGRAM_ID,
		keys: [
			{ pubkey: challenger.publicKey, isSigner: true, isWritable: true },
			{ pubkey: configPda, isSigner: false, isWritable: true },
			{ pubkey: mintChallenger.publicKey, isSigner: true, isWritable: true },
			{ pubkey: challengerBagPda, isSigner: false, isWritable: true },
			{ pubkey: TREASURY, isSigner: false, isWritable: true },
			{ pubkey: MPL_CORE, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data: disc("mint_dice_bag"),
	});
	await sendAndConfirmTransaction(
		conn,
		new Transaction().add(mintChallengerIx),
		[challenger, mintChallenger],
	);
	console.log("✅ Challenger bag:", challengerBagPda.toBase58());

	// Initiate wager
	console.log("\n── Initiate wager ──");
	const initData = Buffer.alloc(8 + 32 + 8 + 1 + 1);
	disc("initiate_wager").copy(initData, 0);
	opponent.publicKey.toBuffer().copy(initData, 8);
	initData.writeBigUInt64LE(BigInt(wagerLamports), 40);
	initData.writeUInt8(0, 48); // game_type = high_low
	initData.writeUInt8(1, 49); // challenger_choice = High

	const initIx = new TransactionInstruction({
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
		data: initData,
	});
	await sendAndConfirmTransaction(conn, new Transaction().add(initIx), [
		challenger,
	]);
	console.log("✅ Wager initiated");

	// Accept wager (triggers VRF with resolved callback)
	console.log("\n── Accept wager (VRF request with resolved callback) ──");
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
	const acceptSig = await sendAndConfirmTransaction(conn, acceptTx, [opponent]);
	console.log("✅ Wager accepted! VRF requested. TX:", acceptSig);

	// Poll for VRF callback
	console.log("\n── Polling for VRF callback (Resolved status) ──");
	const startTime = Date.now();
	const maxWaitMs = 5 * 60 * 1000;
	let resolved = false;
	let winnerKey: PublicKey | null = null;

	while (Date.now() - startTime < maxWaitMs) {
		const wagerAccount = await conn.getAccountInfo(wagerPda);
		const elapsed = Math.round((Date.now() - startTime) / 1000);

		if (!wagerAccount) {
			console.log(
				`  [${elapsed}s] ⚠️ Wager account CLOSED — old settle_wager path was used?`,
			);
			break;
		}

		// Parse wager status from account data
		// Discriminator(8) + challenger(32) + opponent(32) + challenger_bag(32) + amount(8) + game_type(1) + challenger_choice(1) + status(1)
		const statusByte = wagerAccount.data[8 + 32 + 32 + 32 + 8 + 1 + 1];
		const statusNames = [
			"Pending",
			"Active",
			"ReadyToSettle",
			"Settled",
			"Cancelled",
			"Expired",
			"VrfTimeout",
			"Resolved",
		];
		const statusName = statusNames[statusByte] || `Unknown(${statusByte})`;

		console.log(`  [${elapsed}s] Status: ${statusName}`);

		if (statusName === "Resolved") {
			// Parse winner: after status(1) + vrf_requested_at(8) + vrf_fulfilled_at(1+8) + vrf_result(1+1) + winner(1+32)
			// Let's find winner field offset
			// status offset = 8+32+32+32+8+1+1 = 114
			// vrf_requested_at: i64 = 8 bytes → offset 115
			// vrf_fulfilled_at: Option<i64> = 1+8 = 9 bytes → offset 123
			// vrf_result: Option<u8> = 1+1 = 2 bytes → offset 132
			// winner: Option<Pubkey> = 1+32 = 33 bytes → offset 134
			const winnerPresent = wagerAccount.data[134];
			if (winnerPresent === 1) {
				winnerKey = new PublicKey(wagerAccount.data.subarray(135, 167));
			}
			const vrfResultPresent = wagerAccount.data[132];
			const vrfResult = vrfResultPresent === 1 ? wagerAccount.data[133] : null;

			console.log(
				`  🎯 VRF Result: ${vrfResult}, Winner: ${winnerKey?.toBase58().slice(0, 12)}...`,
			);

			const isChallenger = winnerKey?.equals(challenger.publicKey);
			console.log(`  Winner is: ${isChallenger ? "CHALLENGER" : "OPPONENT"}`);
			resolved = true;
			break;
		}

		if (statusName === "ReadyToSettle") {
			console.log(
				`  ⚠️ Got ReadyToSettle — oracle used OLD minimal callback (1 account)`,
			);
			console.log(
				`  FINDING: Oracle did NOT call consume_randomness_resolved with 5 accounts.`,
			);
			console.log(`  Falling back to settle_wager for this wager.`);
			break;
		}

		await new Promise((r) => setTimeout(r, 10_000));
	}

	if (!resolved) {
		if (Date.now() - startTime >= maxWaitMs) {
			console.log("\n❌ VRF not fulfilled after 5 minutes.");
		}
		return;
	}

	// Claim winnings
	console.log("\n── Claim winnings ──");
	const claimer = winnerKey!.equals(challenger.publicKey)
		? challenger
		: opponent;

	const claimIx = new TransactionInstruction({
		programId: PROGRAM_ID,
		keys: [
			{ pubkey: claimer.publicKey, isSigner: true, isWritable: true },
			{ pubkey: wagerPda, isSigner: false, isWritable: true },
			{ pubkey: escrowPda, isSigner: false, isWritable: true },
			{ pubkey: challenger.publicKey, isSigner: false, isWritable: true },
			{ pubkey: configPda, isSigner: false, isWritable: false },
			{ pubkey: TREASURY, isSigner: false, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data: disc("claim_winnings"),
	});

	const claimTx = new Transaction().add(
		ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
		claimIx,
	);
	const claimSig = await sendAndConfirmTransaction(conn, claimTx, [claimer]);
	console.log("✅ Winnings claimed! TX:", claimSig);

	// Verify
	console.log("\n── Verify ──");
	const wagerAfter = await conn.getAccountInfo(wagerPda);
	const escrowAfter = await conn.getBalance(escrowPda);
	console.log("Wager account closed:", wagerAfter === null);
	console.log("Escrow balance:", escrowAfter, "(should be 0)");

	const challengerBal = await conn.getBalance(challenger.publicKey);
	const opponentBal = await conn.getBalance(opponent.publicKey);
	console.log("Challenger balance:", challengerBal / LAMPORTS_PER_SOL, "SOL");
	console.log("Opponent balance:", opponentBal / LAMPORTS_PER_SOL, "SOL");

	// Check stats were updated by callback
	const cStats = await conn.getAccountInfo(challengerStatsPda);
	const oStats = await conn.getAccountInfo(opponentStatsPda);
	if (cStats) {
		const d = cStats.data;
		console.log(
			`Challenger stats: ${d.readUInt32LE(40)} games, ${d.readUInt32LE(44)}W/${d.readUInt32LE(48)}L`,
		);
	}
	if (oStats) {
		const d = oStats.data;
		console.log(
			`Opponent stats: ${d.readUInt32LE(40)} games, ${d.readUInt32LE(44)}W/${d.readUInt32LE(48)}L`,
		);
	}

	console.log("\n" + "═".repeat(60));
	console.log("🎲 V2 TEST COMPLETE");
	console.log("═".repeat(60));
}

main().catch(console.error);
