import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
	type Address,
	address,
	generateKeyPairSigner,
	getProgramDerivedAddress,
	getUtf8Encoder,
} from "@solana/kit";
import { DICE_DUEL_PROGRAM_ID } from "../shared/programs";

// ─── Helpers ───────────────────────────────────────────────────────────

const utf8 = getUtf8Encoder();

function toPublicKey(addr: Address): anchor.web3.PublicKey {
	return new anchor.web3.PublicKey(addr);
}

const PROGRAM_ID = address(DICE_DUEL_PROGRAM_ID);

// Load IDL
const idlPath = path.join(__dirname, "..", "shared", "idl", "dice_duel.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

async function main() {
	// Connect to local validator
	const connection = new anchor.web3.Connection(
		"http://localhost:7899",
		"confirmed",
	);

	// Load wallet
	const keyPath = "/home/node/.config/solana/id.json";
	const secretKey = new Uint8Array(
		JSON.parse(fs.readFileSync(keyPath, "utf8")),
	);
	const wallet = new anchor.Wallet(
		anchor.web3.Keypair.fromSecretKey(secretKey),
	);

	const provider = new anchor.AnchorProvider(connection, wallet, {
		commitment: "confirmed",
	});
	anchor.setProvider(provider);

	const program = new Program(idl, provider);

	console.log("Wallet:", wallet.publicKey.toBase58());
	console.log("Program:", DICE_DUEL_PROGRAM_ID);

	// 1. Initialize config
	const treasury = (await generateKeyPairSigner()).address;
	const [configPda] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [utf8.encode("config")],
	});

	console.log("\n--- Initializing GameConfig ---");
	try {
		const tx = await program.methods
			.initialize(
				toPublicKey(treasury),
				500, // fee_bps = 5%
				new anchor.BN(50_000_000), // mint_price = 0.05 SOL
				10, // initial_uses
				new anchor.BN(600), // wager_expiry = 10 min
				new anchor.BN(900), // vrf_timeout = 15 min
			)
			.accounts({
				admin: wallet.publicKey,
				config: toPublicKey(configPda),
				systemProgram: anchor.web3.SystemProgram.programId,
			})
			.rpc();
		console.log("✅ Config initialized! TX:", tx);
	} catch (e: any) {
		console.log("❌ Initialize failed:", e.message?.slice(0, 200));
	}

	// 2. Register game type (high/low = 0)
	const [gameTypePda] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [utf8.encode("game_type"), new Uint8Array([0])],
	});

	console.log("\n--- Registering Game Type 0 (High/Low) ---");
	try {
		const tx = await program.methods
			.registerGameType(
				0, // id
				"High/Low 50/50", // name
				true, // enabled
			)
			.accounts({
				admin: wallet.publicKey,
				config: toPublicKey(configPda),
				gameType: toPublicKey(gameTypePda),
				systemProgram: anchor.web3.SystemProgram.programId,
			})
			.rpc();
		console.log("✅ Game type registered! TX:", tx);
	} catch (e: any) {
		console.log("❌ Register game type failed:", e.message?.slice(0, 200));
	}

	// 3. Read config back
	console.log("\n--- Reading GameConfig ---");
	try {
		const config = await program.account.gameConfig.fetch(
			toPublicKey(configPda),
		);
		console.log(
			"✅ Config:",
			JSON.stringify(
				{
					admin: config.admin.toBase58(),
					treasury: config.treasury.toBase58(),
					feeBps: config.feeBps,
					mintPrice: config.mintPrice.toString(),
					initialUses: config.initialUses,
					isPaused: config.isPaused,
					wagerExpirySeconds: config.wagerExpirySeconds.toString(),
					vrfTimeoutSeconds: config.vrfTimeoutSeconds.toString(),
				},
				null,
				2,
			),
		);
	} catch (e: any) {
		console.log("❌ Read config failed:", e.message?.slice(0, 200));
	}

	// 4. Read game type
	console.log("\n--- Reading GameType 0 ---");
	try {
		const gt = await program.account.gameType.fetch(toPublicKey(gameTypePda));
		console.log(
			"✅ GameType:",
			JSON.stringify(
				{
					id: gt.id,
					name: Buffer.from(gt.name).toString().replace(/\0/g, ""),
					enabled: gt.enabled,
				},
				null,
				2,
			),
		);
	} catch (e: any) {
		console.log("❌ Read game type failed:", e.message?.slice(0, 200));
	}

	console.log("\n🎲 DiceDuel is LIVE on local validator!");
}

main().catch(console.error);
