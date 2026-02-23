/**
 * DiceDuel Devnet Initialize Script (raw @solana/web3.js, no Anchor dep)
 *
 * Builds instructions manually using Anchor discriminators + Borsh serialization.
 * Runs from programs/dice-duel/ context which has @solana/web3.js installed.
 *
 * Usage: cd programs/dice-duel && npx tsx ../../scripts/init-devnet.ts
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
	sendAndConfirmTransaction,
} from "@solana/web3.js";

// ─── Config ────────────────────────────────────────────────────────────

const TREASURY = new PublicKey("BLq7QBexFpPDg2WMu4JaL67X7SEdnyvXGtcoEvdncq4m");
const PROGRAM_ID = new PublicKey(
	"D8YzrLvAiwNmJF6gjAKLVQkqSNx5zD7TH7anqC52noof",
);
const DEVNET_RPC = "https://api.devnet.solana.com";

const FEE_BPS = 500;
const MINT_PRICE = BigInt(50_000_000);
const INITIAL_USES = 10;
const WAGER_EXPIRY = BigInt(600);
const VRF_TIMEOUT = BigInt(900);

// ─── Helpers ───────────────────────────────────────────────────────────

function anchorDiscriminator(name: string): Buffer {
	const hash = crypto.createHash("sha256").update(`global:${name}`).digest();
	return hash.subarray(0, 8);
}

function serializeInitArgs(): Buffer {
	// treasury: pubkey (32 bytes)
	// fee_bps: u16 LE (2 bytes)
	// mint_price: u64 LE (8 bytes)
	// initial_uses: u8 (1 byte)
	// wager_expiry_seconds: i64 LE (8 bytes)
	// vrf_timeout_seconds: i64 LE (8 bytes)
	const buf = Buffer.alloc(32 + 2 + 8 + 1 + 8 + 8);
	let offset = 0;

	// treasury pubkey
	TREASURY.toBuffer().copy(buf, offset);
	offset += 32;

	// fee_bps u16 LE
	buf.writeUInt16LE(FEE_BPS, offset);
	offset += 2;

	// mint_price u64 LE
	buf.writeBigUInt64LE(MINT_PRICE, offset);
	offset += 8;

	// initial_uses u8
	buf.writeUInt8(INITIAL_USES, offset);
	offset += 1;

	// wager_expiry_seconds i64 LE
	buf.writeBigInt64LE(WAGER_EXPIRY, offset);
	offset += 8;

	// vrf_timeout_seconds i64 LE
	buf.writeBigInt64LE(VRF_TIMEOUT, offset);
	offset += 8;

	return buf;
}

function serializeRegisterGameTypeArgs(
	id: number,
	name: string,
	enabled: boolean,
): Buffer {
	// id: u8 (1 byte)
	// name: string (4 bytes len + utf8)
	// enabled: bool (1 byte)
	const nameBytes = Buffer.from(name, "utf8");
	const buf = Buffer.alloc(1 + 4 + nameBytes.length + 1);
	let offset = 0;

	buf.writeUInt8(id, offset);
	offset += 1;

	buf.writeUInt32LE(nameBytes.length, offset);
	offset += 4;

	nameBytes.copy(buf, offset);
	offset += nameBytes.length;

	buf.writeUInt8(enabled ? 1 : 0, offset);

	return buf;
}

// ─── PDAs ──────────────────────────────────────────────────────────────

const [configPda] = PublicKey.findProgramAddressSync(
	[Buffer.from("config")],
	PROGRAM_ID,
);

const [gameTypePda] = PublicKey.findProgramAddressSync(
	[Buffer.from("game_type"), Buffer.from([0])],
	PROGRAM_ID,
);

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
	const connection = new Connection(DEVNET_RPC, "confirmed");

	const keyPath = path.join(
		process.env.HOME || "/home/node",
		".config/solana/id.json",
	);
	const secretKey = JSON.parse(fs.readFileSync(keyPath, "utf8"));
	const deployer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

	console.log("═══════════════════════════════════════════════════");
	console.log("  DiceDuel Devnet Init Script");
	console.log("═══════════════════════════════════════════════════");
	console.log(`  Deployer/Admin: ${deployer.publicKey.toBase58()}`);
	console.log(`  Treasury:       ${TREASURY.toBase58()}`);
	console.log(`  Program:        ${PROGRAM_ID.toBase58()}`);
	console.log(`  Config PDA:     ${configPda.toBase58()}`);
	console.log(`  GameType PDA:   ${gameTypePda.toBase58()}`);
	console.log("═══════════════════════════════════════════════════\n");

	const balance = await connection.getBalance(deployer.publicKey);
	console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

	// ─── Step 1: Initialize ────────────────────────────────────────────
	const configInfo = await connection.getAccountInfo(configPda);
	if (configInfo) {
		console.log("✅ GameConfig already initialized, skipping.\n");
	} else {
		console.log("Initializing GameConfig...");
		const disc = anchorDiscriminator("initialize");
		const args = serializeInitArgs();
		const data = Buffer.concat([disc, args]);

		const ix = new TransactionInstruction({
			keys: [
				{ pubkey: deployer.publicKey, isSigner: true, isWritable: true },
				{ pubkey: configPda, isSigner: false, isWritable: true },
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			],
			programId: PROGRAM_ID,
			data,
		});

		const tx = new Transaction().add(ix);
		const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
		console.log(`✅ GameConfig initialized! TX: ${sig}`);
		console.log(`   https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);
	}

	// ─── Step 2: Register Game Type 0 ─────────────────────────────────
	const gameTypeInfo = await connection.getAccountInfo(gameTypePda);
	if (gameTypeInfo) {
		console.log("✅ Game Type 0 already registered, skipping.\n");
	} else {
		console.log("Registering Game Type 0 (High/Low)...");
		const disc = anchorDiscriminator("register_game_type");
		const args = serializeRegisterGameTypeArgs(0, "High/Low", true);
		const data = Buffer.concat([disc, args]);

		const ix = new TransactionInstruction({
			keys: [
				{ pubkey: deployer.publicKey, isSigner: true, isWritable: true },
				{ pubkey: configPda, isSigner: false, isWritable: false },
				{ pubkey: gameTypePda, isSigner: false, isWritable: true },
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			],
			programId: PROGRAM_ID,
			data,
		});

		const tx = new Transaction().add(ix);
		const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
		console.log(`✅ Game Type 0 registered! TX: ${sig}`);
		console.log(`   https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);
	}

	// ─── Verify ────────────────────────────────────────────────────────
	console.log("═══════════════════════════════════════════════════");
	console.log("  Verification");
	console.log("═══════════════════════════════════════════════════");
	const finalConfig = await connection.getAccountInfo(configPda);
	const finalGameType = await connection.getAccountInfo(gameTypePda);
	console.log(
		`  Config:    ${finalConfig ? "✅ EXISTS (" + finalConfig.data.length + " bytes)" : "❌ MISSING"}`,
	);
	console.log(
		`  GameType:  ${finalGameType ? "✅ EXISTS (" + finalGameType.data.length + " bytes)" : "❌ MISSING"}`,
	);

	const finalBalance = await connection.getBalance(deployer.publicKey);
	console.log(
		`\n  Remaining balance: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
	);
	console.log("\n🎲 DiceDuel is live on devnet!");
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
