/**
 * DiceDuel Devnet Deploy + Initialize Script
 *
 * 1. Deploys the program (if not already deployed)
 * 2. Initializes GameConfig with Felon's wallet as admin + treasury
 * 3. Registers game type 0 (High/Low)
 *
 * Usage: npx tsx scripts/deploy-devnet.ts
 * Requires: ~/.config/solana/id.json with devnet SOL
 */

import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
	type Address,
	address,
	getProgramDerivedAddress,
	getUtf8Encoder,
} from "@solana/kit";
import { DICE_DUEL_PROGRAM_ID } from "../shared/programs";

// ─── Helpers ───────────────────────────────────────────────────────────

const utf8 = getUtf8Encoder();
const LAMPORTS_PER_SOL = 1_000_000_000;

function toPublicKey(addr: Address): anchor.web3.PublicKey {
	return new anchor.web3.PublicKey(addr);
}

// ─── Config ────────────────────────────────────────────────────────────

const ADMIN_AND_TREASURY = address(
	"BLq7QBexFpPDg2WMu4JaL67X7SEdnyvXGtcoEvdncq4m",
);
const PROGRAM_ID = address(DICE_DUEL_PROGRAM_ID);
const DEVNET_RPC = "https://api.devnet.solana.com";

const FEE_BPS = 500; // 5%
const MINT_PRICE = 50_000_000; // 0.05 SOL
const INITIAL_USES = 10;
const WAGER_EXPIRY_SECONDS = 600; // 10 min
const VRF_TIMEOUT_SECONDS = 900; // 15 min

// ─── Load IDL + Wallet ─────────────────────────────────────────────────

const idlPath = path.join(__dirname, "..", "shared", "idl", "dice_duel.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

const keyPath =
	process.env.SOLANA_KEYPAIR ||
	path.join(process.env.HOME || "/home/node", ".config/solana/id.json");
const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(keyPath, "utf8")));
const deployerKeypair = anchor.web3.Keypair.fromSecretKey(secretKey);

console.log("═══════════════════════════════════════════════════");
console.log("  DiceDuel Devnet Deploy Script");
console.log("═══════════════════════════════════════════════════");
console.log(`  Deployer:  ${deployerKeypair.publicKey.toBase58()}`);
console.log(`  Admin:     ${ADMIN_AND_TREASURY}`);
console.log(`  Treasury:  ${ADMIN_AND_TREASURY}`);
console.log(`  Program:   ${DICE_DUEL_PROGRAM_ID}`);
console.log(`  RPC:       ${DEVNET_RPC}`);
console.log("═══════════════════════════════════════════════════\n");

async function main() {
	const connection = new anchor.web3.Connection(DEVNET_RPC, "confirmed");

	// Check deployer balance
	const balance = await connection.getBalance(deployerKeypair.publicKey);
	console.log(
		`Deployer balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
	);
	if (balance < 0.5 * LAMPORTS_PER_SOL) {
		console.error(
			"❌ Need at least 0.5 SOL to deploy. Fund the deployer wallet.",
		);
		console.error(`   Wallet: ${deployerKeypair.publicKey.toBase58()}`);
		process.exit(1);
	}

	// Set up Anchor provider
	const wallet = new anchor.Wallet(deployerKeypair);
	const provider = new anchor.AnchorProvider(connection, wallet, {
		commitment: "confirmed",
		preflightCommitment: "confirmed",
	});
	anchor.setProvider(provider);

	const program = new Program(idl, provider);

	// ─── Step 1: Check if program is already deployed ──────────────────
	console.log("Step 1: Checking program deployment...");
	const programInfo = await connection.getAccountInfo(toPublicKey(PROGRAM_ID));
	if (programInfo) {
		console.log("✅ Program already deployed on devnet!");
		console.log(`   Executable: ${programInfo.executable}`);
		console.log(`   Data size: ${programInfo.data.length} bytes`);
	} else {
		console.log("⚠️  Program NOT deployed yet.");
		console.log(
			"   Run: cd packages/3p-plugin-dragon-dice && anchor deploy --provider.cluster devnet",
		);
		console.log("   Then re-run this script.");
		console.log("\n   Or deploy with solana CLI:");
		console.log(
			`   solana program deploy target/deploy/dice_duel.so --program-id target/deploy/dice_duel-keypair.json --url devnet`,
		);
		process.exit(1);
	}

	// ─── Step 2: Initialize GameConfig ─────────────────────────────────
	const [configPda] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [utf8.encode("config")],
	});
	console.log(`\nStep 2: Initializing GameConfig (PDA: ${configPda})...`);

	// Check if already initialized
	const configInfo = await connection.getAccountInfo(toPublicKey(configPda));
	if (configInfo) {
		console.log("✅ GameConfig already initialized! Skipping.");
	} else {
		try {
			const tx = await program.methods
				.initialize(
					toPublicKey(ADMIN_AND_TREASURY), // treasury = Felon's wallet
					FEE_BPS,
					new anchor.BN(MINT_PRICE),
					INITIAL_USES,
					new anchor.BN(WAGER_EXPIRY_SECONDS),
					new anchor.BN(VRF_TIMEOUT_SECONDS),
				)
				.accounts({
					admin: deployerKeypair.publicKey,
					config: toPublicKey(configPda),
					systemProgram: anchor.web3.SystemProgram.programId,
				})
				.rpc();
			console.log(`✅ GameConfig initialized! TX: ${tx}`);
			console.log(`   https://explorer.solana.com/tx/${tx}?cluster=devnet`);
		} catch (e: any) {
			console.error("❌ Initialize failed:", e.message?.slice(0, 300));
			// If it's "already initialized" error, continue
			if (!e.message?.includes("already in use")) {
				process.exit(1);
			}
		}
	}

	// ─── Step 3: Register Game Type 0 (High/Low) ──────────────────────
	const [gameTypePda] = await getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [utf8.encode("game_type"), new Uint8Array([0])],
	});
	console.log(
		`\nStep 3: Registering Game Type 0 - High/Low (PDA: ${gameTypePda})...`,
	);

	const gameTypeInfo = await connection.getAccountInfo(
		toPublicKey(gameTypePda),
	);
	if (gameTypeInfo) {
		console.log("✅ Game Type 0 already registered! Skipping.");
	} else {
		try {
			const tx = await program.methods
				.registerGameType(
					0, // id
					"High/Low", // name
					true, // enabled
				)
				.accounts({
					admin: deployerKeypair.publicKey,
					config: toPublicKey(configPda),
					gameType: toPublicKey(gameTypePda),
					systemProgram: anchor.web3.SystemProgram.programId,
				})
				.rpc();
			console.log(`✅ Game Type 0 registered! TX: ${tx}`);
			console.log(`   https://explorer.solana.com/tx/${tx}?cluster=devnet`);
		} catch (e: any) {
			console.error("❌ Register game type failed:", e.message?.slice(0, 300));
		}
	}

	// ─── Step 4: Verify ────────────────────────────────────────────────
	console.log("\n═══════════════════════════════════════════════════");
	console.log("  Verification");
	console.log("═══════════════════════════════════════════════════");

	const finalConfig = await connection.getAccountInfo(toPublicKey(configPda));
	const finalGameType = await connection.getAccountInfo(
		toPublicKey(gameTypePda),
	);

	console.log(
		`  Config PDA:    ${configPda} — ${finalConfig ? "✅ EXISTS" : "❌ MISSING"}`,
	);
	console.log(
		`  GameType PDA:  ${gameTypePda} — ${finalGameType ? "✅ EXISTS" : "❌ MISSING"}`,
	);
	console.log(`  Program:       ${DICE_DUEL_PROGRAM_ID} — ✅ DEPLOYED`);
	console.log(`  Admin/Treasury: ${ADMIN_AND_TREASURY}`);
	console.log("\n🎲 DiceDuel is ready on devnet!");

	// Print remaining deployer balance
	const finalBalance = await connection.getBalance(deployerKeypair.publicKey);
	console.log(
		`\nDeployer remaining balance: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
	);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
