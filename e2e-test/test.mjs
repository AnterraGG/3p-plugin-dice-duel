import pkg from "@coral-xyz/anchor";
const { AnchorProvider, Program, BN, web3 } = pkg;
import sol from "@solana/web3.js";
const { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = sol;
const SYSVAR_SLOT_HASHES_PUBKEY = new PublicKey(
	"SysvarS1otHashes111111111111111111111111111",
);
import fs from "fs";

const RPC =
	"https://devnet.helius-rpc.com/?api-key=e97f43d4-ee09-4081-8260-6bfd0fb78fb7";
const PROGRAM_ID = new PublicKey(
	"2JhsTkFQc11pTE1rzAKJno2TbBMCzNJhEUsWBeRunBcN",
);
const VRF_PROGRAM = new PublicKey(
	"Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
);
const DEFAULT_QUEUE = new PublicKey(
	"Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);
const TREASURY = new PublicKey("BLq7QBexFpPDg2WMu4JaL67X7SEdnyvXGtcoEvdncq4m");
const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rKrKLhdt");

const idl = JSON.parse(fs.readFileSync("../target/idl/dice_duel.json", "utf8"));
const adminKey = JSON.parse(
	fs.readFileSync(
		"/home/node/.openclaw/secrets/devnet-keypairs/admin.json",
		"utf8",
	),
);
const admin = Keypair.fromSecretKey(Uint8Array.from(adminKey));

const connection = new Connection(RPC, "confirmed");
const wallet = {
	publicKey: admin.publicKey,
	signTransaction: async (tx) => {
		tx.sign([admin]);
		return tx;
	},
	signAllTransactions: async (txs) => {
		txs.forEach((t) => t.sign([admin]));
		return txs;
	},
};
const provider = new AnchorProvider(connection, wallet, {
	commitment: "confirmed",
	preflightCommitment: "confirmed",
});
const program = new Program(idl, provider);

// PDA helpers
const findPDA = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
const configPDA = findPDA([Buffer.from("config")])[0];
const gameTypePDA = (id) =>
	findPDA([Buffer.from("game_type"), Buffer.from([id])])[0];
const wagerPDA = (challenger) =>
	findPDA([Buffer.from("wager"), challenger.toBuffer()]);
const escrowPDA = (wagerKey) =>
	findPDA([Buffer.from("escrow"), wagerKey.toBuffer()]);
const statsPDA = (player) => findPDA([Buffer.from("stats"), player.toBuffer()]);
const diceBagPDA = (mint) =>
	findPDA([Buffer.from("dice_bag"), mint.toBuffer()]);
const identityPDA = PublicKey.findProgramAddressSync(
	[Buffer.from("identity")],
	PROGRAM_ID,
)[0];

async function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	console.log("Admin:", admin.publicKey.toBase58());
	const bal = await connection.getBalance(admin.publicKey);
	console.log("Balance:", bal / LAMPORTS_PER_SOL, "SOL");

	// Step 1: Check if config exists, initialize if not
	console.log("\n=== Step 1: Initialize Config ===");
	const configAccount = await connection.getAccountInfo(configPDA);
	if (configAccount) {
		console.log("Config already initialized");
	} else {
		console.log("Initializing config...");
		const tx = await program.methods
			.initialize(
				TREASURY,
				250, // fee_bps (2.5%)
				new BN(10_000_000), // mint_price (0.01 SOL)
				10, // initial_uses
				new BN(3600), // wager_expiry_seconds
				new BN(300), // vrf_timeout_seconds
			)
			.accounts({
				admin: admin.publicKey,
				config: configPDA,
				systemProgram: SystemProgram.programId,
			})
			.signers([admin])
			.rpc();
		console.log("Init tx:", tx);
	}

	// Step 2: Register game type 0 if needed
	console.log("\n=== Step 2: Register Game Type ===");
	const gt0 = gameTypePDA(0);
	const gtAccount = await connection.getAccountInfo(gt0);
	if (gtAccount) {
		console.log("Game type 0 already registered");
	} else {
		console.log("Registering game type 0...");
		const tx = await program.methods
			.registerGameType(0, "High/Low", true)
			.accounts({
				admin: admin.publicKey,
				config: configPDA,
				gameType: gt0,
				systemProgram: SystemProgram.programId,
			})
			.signers([admin])
			.rpc();
		console.log("Register tx:", tx);
	}

	// Step 3: Create second player keypair + fund it
	console.log("\n=== Step 3: Setup Players ===");
	const playerB = Keypair.generate();
	console.log("Player B:", playerB.publicKey.toBase58());

	// Fund player B
	const fundTx = new web3.Transaction().add(
		SystemProgram.transfer({
			fromPubkey: admin.publicKey,
			toPubkey: playerB.publicKey,
			lamports: 0.5 * LAMPORTS_PER_SOL,
		}),
	);
	fundTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
	fundTx.feePayer = admin.publicKey;
	fundTx.sign(admin);
	const fundSig = await connection.sendRawTransaction(fundTx.serialize());
	await connection.confirmTransaction(fundSig, "confirmed");
	console.log("Funded Player B:", fundSig);

	// Step 4: Mint dice bags for both players
	console.log("\n=== Step 4: Mint Dice Bags ===");

	// Mint for Player A (admin)
	const mintA = Keypair.generate();
	console.log("Mint A:", mintA.publicKey.toBase58());
	const bagA = diceBagPDA(mintA.publicKey)[0];

	const mintATx = await program.methods
		.mintDiceBag()
		.accounts({
			player: admin.publicKey,
			config: configPDA,
			mint: mintA.publicKey,
			diceBag: bagA,
			treasury: TREASURY,
			mplCoreProgram: MPL_CORE,
			systemProgram: SystemProgram.programId,
		})
		.signers([admin, mintA])
		.rpc();
	console.log("Mint A tx:", mintATx);

	// Mint for Player B
	const mintB = Keypair.generate();
	console.log("Mint B:", mintB.publicKey.toBase58());
	const bagB = diceBagPDA(mintB.publicKey)[0];

	// Need to use playerB as signer
	const mintBTx = await program.methods
		.mintDiceBag()
		.accounts({
			player: playerB.publicKey,
			config: configPDA,
			mint: mintB.publicKey,
			diceBag: bagB,
			treasury: TREASURY,
			mplCoreProgram: MPL_CORE,
			systemProgram: SystemProgram.programId,
		})
		.signers([playerB, mintB])
		.rpc();
	console.log("Mint B tx:", mintBTx);

	// Step 5: Player A initiates wager
	console.log("\n=== Step 5: Initiate Wager ===");
	const [wagerKey] = wagerPDA(admin.publicKey);
	const [escrowKey] = escrowPDA(wagerKey);

	const wagerAmount = new BN(50_000_000); // 0.05 SOL
	const initWagerTx = await program.methods
		.initiateWager(
			playerB.publicKey, // opponent
			wagerAmount,
			0, // game_type (high/low)
			1, // challenger_choice (1 = high)
		)
		.accounts({
			challenger: admin.publicKey,
			challengerBag: bagA,
			wager: wagerKey,
			escrow: escrowKey,
			config: configPDA,
			gameTypeAccount: gt0,
			systemProgram: SystemProgram.programId,
		})
		.signers([admin])
		.rpc();
	console.log("Initiate wager tx:", initWagerTx);

	// Verify wager state
	let wagerAccount = await program.account.wager.fetch(wagerKey);
	console.log("Wager status:", wagerAccount.status); // Should be Pending (0) or { pending: {} }
	console.log("Wager amount:", wagerAccount.amount.toString());

	// Step 6: Player B accepts wager (triggers VRF)
	console.log("\n=== Step 6: Accept Wager (triggers VRF) ===");
	const [challengerStatsKey] = statsPDA(admin.publicKey);
	const [opponentStatsKey] = statsPDA(playerB.publicKey);

	// Build accept wager with VRF accounts
	const acceptTx = await program.methods
		.acceptWager()
		.accounts({
			opponent: playerB.publicKey,
			wager: wagerKey,
			challenger: admin.publicKey,
			challengerBag: bagA,
			escrow: escrowKey,
			config: configPDA,
			challengerStats: challengerStatsKey,
			opponentStats: opponentStatsKey,
			oracleQueue: DEFAULT_QUEUE,
			systemProgram: SystemProgram.programId,
			programIdentity: identityPDA,
			vrfProgram: VRF_PROGRAM,
			slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
		})
		.signers([playerB])
		.rpc();
	console.log("Accept wager tx:", acceptTx);

	// Check wager state
	wagerAccount = await program.account.wager.fetch(wagerKey);
	console.log(
		"Wager status after accept:",
		JSON.stringify(wagerAccount.status),
	);
	console.log("VRF requested at:", wagerAccount.vrfRequestedAt?.toString());

	// Step 7: Poll for VRF callback
	console.log("\n=== Step 7: Waiting for VRF callback ===");
	const maxWait = 60; // seconds
	let vrfFulfilled = false;
	for (let i = 0; i < maxWait; i += 3) {
		await sleep(3000);
		try {
			wagerAccount = await program.account.wager.fetch(wagerKey);
			const statusStr = JSON.stringify(wagerAccount.status);
			console.log(
				`[${i + 3}s] Status: ${statusStr}, VRF result: ${wagerAccount.vrfResult}, VRF fulfilled: ${wagerAccount.vrfFulfilledAt?.toString()}`,
			);

			if (
				wagerAccount.vrfResult !== null &&
				wagerAccount.vrfResult !== undefined
			) {
				vrfFulfilled = true;
				console.log(
					"\n🎲 VRF CALLBACK RECEIVED! Result:",
					wagerAccount.vrfResult,
				);
				break;
			}
		} catch (e) {
			console.log(`[${i + 3}s] Error fetching wager:`, e.message);
		}
	}

	if (!vrfFulfilled) {
		console.log("\n❌ VRF callback did NOT fire within", maxWait, "seconds");
		console.log("Accept wager tx signature:", acceptTx);
		console.log(
			"Check: https://explorer.solana.com/tx/" + acceptTx + "?cluster=devnet",
		);

		// Try to get tx logs
		try {
			const txInfo = await connection.getTransaction(acceptTx, {
				maxSupportedTransactionVersion: 0,
				commitment: "confirmed",
			});
			console.log("\nAccept wager tx logs:");
			txInfo?.meta?.logMessages?.forEach((l) => console.log("  ", l));
		} catch (e) {}

		return;
	}

	// Step 8: Settle wager
	console.log("\n=== Step 8: Settle Wager ===");
	const settleTx = await program.methods
		.settleWager()
		.accounts({
			settler: admin.publicKey,
			wager: wagerKey,
			escrow: escrowKey,
			challenger: admin.publicKey,
			opponent: playerB.publicKey,
			challengerBag: bagA,
			challengerStats: challengerStatsKey,
			opponentStats: opponentStatsKey,
			config: configPDA,
			treasury: TREASURY,
			systemProgram: SystemProgram.programId,
		})
		.signers([admin])
		.rpc();
	console.log("Settle tx:", settleTx);

	// Verify final state
	console.log("\n=== Step 9: Verify Results ===");
	try {
		// Wager should be closed, fetching should fail
		await program.account.wager.fetch(wagerKey);
		console.log("⚠️ Wager account still exists (should be closed)");
	} catch (e) {
		console.log("✅ Wager account closed (expected)");
	}

	const adminBal = await connection.getBalance(admin.publicKey);
	const playerBBal = await connection.getBalance(playerB.publicKey);
	console.log("Admin final balance:", adminBal / LAMPORTS_PER_SOL, "SOL");
	console.log("Player B final balance:", playerBBal / LAMPORTS_PER_SOL, "SOL");

	try {
		const cStats = await program.account.playerStats.fetch(challengerStatsKey);
		console.log(
			"Challenger stats:",
			JSON.stringify({
				games: cStats.totalGames,
				wins: cStats.wins,
				losses: cStats.losses,
			}),
		);
	} catch (e) {}

	try {
		const oStats = await program.account.playerStats.fetch(opponentStatsKey);
		console.log(
			"Opponent stats:",
			JSON.stringify({
				games: oStats.totalGames,
				wins: oStats.wins,
				losses: oStats.losses,
			}),
		);
	} catch (e) {}

	console.log("\n🎉 E2E TEST COMPLETE!");
}

main().catch((e) => {
	console.error("\n💥 FATAL ERROR:", e.message);
	if (e.logs) {
		console.error("Logs:");
		e.logs.forEach((l) => console.error("  ", l));
	}
	process.exit(1);
});
