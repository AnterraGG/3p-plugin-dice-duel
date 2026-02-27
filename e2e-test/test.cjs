const anchor = require("@coral-xyz/anchor");
const { AnchorProvider, Program, BN, web3 } = anchor;
const {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	LAMPORTS_PER_SOL,
	SYSVAR_SLOT_HASHES_PUBKEY,
} = web3;
const fs = require("fs");

const RPC = process.env.HELIUS_RPC_URL || "https://api.devnet.solana.com";
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
const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

const idl = JSON.parse(fs.readFileSync("../target/idl/dice_duel.json", "utf8"));
const adminKey = JSON.parse(
	fs.readFileSync(
		process.env.ADMIN_KEYPAIR_PATH || (process.env.HOME + "/.config/solana/id.json"),
		"utf8",
	),
);
const admin = Keypair.fromSecretKey(Uint8Array.from(adminKey));

const connection = new Connection(RPC, "confirmed");
const wallet = {
	publicKey: admin.publicKey,
	signTransaction: async (tx) => {
		tx.sign(admin);
		return tx;
	},
	signAllTransactions: async (txs) => {
		txs.forEach((t) => t.sign(admin));
		return txs;
	},
};
const provider = new AnchorProvider(connection, wallet, {
	commitment: "confirmed",
	preflightCommitment: "confirmed",
});
const program = new Program(idl, provider);

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

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	console.log("Admin:", admin.publicKey.toBase58());
	const bal = await connection.getBalance(admin.publicKey);
	console.log("Balance:", bal / LAMPORTS_PER_SOL, "SOL");

	// Step 1: Check if config exists
	console.log("\n=== Step 1: Initialize Config ===");
	const configAccount = await connection.getAccountInfo(configPDA);
	if (configAccount) {
		console.log("Config already initialized at", configPDA.toBase58());
	} else {
		console.log("Initializing config...");
		const tx = await program.methods
			.initialize(
				TREASURY,
				250,
				new BN(10_000_000),
				10,
				new BN(3600),
				new BN(300),
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

	// Step 2: Register game type 0
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

	// Step 3: Create + fund player B
	console.log("\n=== Step 3: Setup Players ===");
	const playerB = Keypair.generate();
	console.log("Player B:", playerB.publicKey.toBase58());

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

	// Step 4: Mint dice bags
	console.log("\n=== Step 4: Mint Dice Bags ===");
	const mintA = Keypair.generate();
	const bagA = diceBagPDA(mintA.publicKey)[0];
	console.log("Mint A:", mintA.publicKey.toBase58(), "Bag A:", bagA.toBase58());

	const mintAIx = await program.methods
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
		.instruction();
	const mintATxn = new web3.Transaction().add(mintAIx);
	mintATxn.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
	mintATxn.feePayer = admin.publicKey;
	mintATxn.sign(admin, mintA);
	const mintASig = await connection.sendRawTransaction(mintATxn.serialize());
	await connection.confirmTransaction(mintASig, "confirmed");
	console.log("Mint A tx:", mintASig);

	const mintB = Keypair.generate();
	const bagB = diceBagPDA(mintB.publicKey)[0];
	console.log("Mint B:", mintB.publicKey.toBase58(), "Bag B:", bagB.toBase58());

	const mintBIx = await program.methods
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
		.instruction();

	const mintBTxn = new web3.Transaction().add(mintBIx);
	mintBTxn.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
	mintBTxn.feePayer = playerB.publicKey;
	mintBTxn.sign(playerB, mintB);
	const mintBSig = await connection.sendRawTransaction(mintBTxn.serialize());
	await connection.confirmTransaction(mintBSig, "confirmed");
	console.log("Mint B tx:", mintBSig);

	// Step 5: Initiate wager
	console.log("\n=== Step 5: Initiate Wager ===");
	const [wagerKey] = wagerPDA(admin.publicKey);
	const [escrowKey] = escrowPDA(wagerKey);
	console.log("Wager PDA:", wagerKey.toBase58());
	console.log("Escrow PDA:", escrowKey.toBase58());

	const wagerAmount = new BN(50_000_000); // 0.05 SOL
	const initWagerTx = await program.methods
		.initiateWager(playerB.publicKey, wagerAmount, 0, 1)
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

	let wagerAccount = await program.account.wager.fetch(wagerKey);
	console.log("Wager status:", JSON.stringify(wagerAccount.status));
	console.log("Wager amount:", wagerAccount.amount.toString());

	// Step 6: Accept wager (triggers VRF)
	console.log("\n=== Step 6: Accept Wager (triggers VRF) ===");
	const [challengerStatsKey] = statsPDA(admin.publicKey);
	const [opponentStatsKey] = statsPDA(playerB.publicKey);

	const acceptIx = await program.methods
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
		.instruction();

	const acceptTxn = new web3.Transaction().add(acceptIx);
	acceptTxn.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
	acceptTxn.feePayer = playerB.publicKey;
	acceptTxn.sign(playerB);
	const acceptSig = await connection.sendRawTransaction(acceptTxn.serialize());
	await connection.confirmTransaction(acceptSig, "confirmed");
	console.log("Accept wager tx:", acceptSig);

	wagerAccount = await program.account.wager.fetch(wagerKey);
	console.log(
		"Wager status after accept:",
		JSON.stringify(wagerAccount.status),
	);

	// Step 7: Poll for VRF
	console.log("\n=== Step 7: Waiting for VRF callback ===");
	const maxWait = 90;
	let vrfFulfilled = false;
	for (let i = 0; i < maxWait; i += 3) {
		await sleep(3000);
		try {
			wagerAccount = await program.account.wager.fetch(wagerKey);
			const statusStr = JSON.stringify(wagerAccount.status);
			const vrfRes = wagerAccount.vrfResult;
			const vrfAt = wagerAccount.vrfFulfilledAt;
			console.log(
				`[${i + 3}s] Status: ${statusStr}, VRF result: ${vrfRes}, VRF fulfilled: ${vrfAt?.toString()}`,
			);

			if (vrfRes !== null && vrfRes !== undefined) {
				vrfFulfilled = true;
				console.log("\n🎲 VRF CALLBACK RECEIVED! Result:", vrfRes);
				break;
			}
		} catch (e) {
			console.log(`[${i + 3}s] Error:`, e.message?.substring(0, 100));
		}
	}

	if (!vrfFulfilled) {
		console.log("\n❌ VRF callback did NOT fire within", maxWait, "seconds");
		console.log("Accept wager tx:", acceptSig);
		console.log(
			"Explorer: https://explorer.solana.com/tx/" +
				acceptSig +
				"?cluster=devnet",
		);
		try {
			const txInfo = await connection.getTransaction(acceptSig, {
				maxSupportedTransactionVersion: 0,
			});
			console.log("\nAccept tx logs:");
			txInfo?.meta?.logMessages?.forEach((l) => console.log("  ", l));
		} catch (e) {}
		return;
	}

	// Step 8: Settle
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

	// Step 9: Verify
	console.log("\n=== Step 9: Verify Results ===");
	try {
		await program.account.wager.fetch(wagerKey);
		console.log("⚠️ Wager account still exists");
	} catch (e) {
		console.log("✅ Wager account closed");
	}

	const adminBal = await connection.getBalance(admin.publicKey);
	const playerBBal = await connection.getBalance(playerB.publicKey);
	console.log("Admin balance:", adminBal / LAMPORTS_PER_SOL, "SOL");
	console.log("Player B balance:", playerBBal / LAMPORTS_PER_SOL, "SOL");

	try {
		const cs = await program.account.playerStats.fetch(challengerStatsKey);
		console.log(
			"Challenger stats:",
			JSON.stringify({ g: cs.totalGames, w: cs.wins, l: cs.losses }),
		);
	} catch (e) {}
	try {
		const os = await program.account.playerStats.fetch(opponentStatsKey);
		console.log(
			"Opponent stats:",
			JSON.stringify({ g: os.totalGames, w: os.wins, l: os.losses }),
		);
	} catch (e) {}

	console.log("\n🎉 E2E TEST COMPLETE!");
}

main().catch((e) => {
	console.error("\n💥 FATAL:", e.message);
	if (e.logs) e.logs.forEach((l) => console.error("  ", l));
	process.exit(1);
});
