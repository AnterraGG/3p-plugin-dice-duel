import * as crypto from "crypto";
import * as fs from "fs";
/**
 * Test MagicBlock's own example program on devnet to see if VRF oracle fulfills
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

const EXAMPLE_PROGRAM = new PublicKey(
	"5AUHCWm4TzipCWK9H3EKx9JNccEA3rfNSUp4BCy2Zy2f",
);
const VRF_PROGRAM_ID = new PublicKey(
	"Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
);
const DEFAULT_QUEUE = new PublicKey(
	"Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);
const SLOT_HASHES = new PublicKey(
	"SysvarS1otHashes111111111111111111111111111",
);

function anchorDisc(namespace: string, name: string): Buffer {
	return Buffer.from(
		crypto
			.createHash("sha256")
			.update(`${namespace}:${name}`)
			.digest()
			.subarray(0, 8),
	);
}

async function main() {
	const conn = new Connection("https://api.devnet.solana.com", "confirmed");
	const adminKey = JSON.parse(
		fs.readFileSync(process.env.SOLANA_KEYPAIR || (process.env.HOME + "/.config/solana/id.json"), "utf8"),
	);
	const payer = Keypair.fromSecretKey(Uint8Array.from(adminKey));

	console.log("Payer:", payer.publicKey.toBase58());
	console.log(
		"Balance:",
		(await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL,
		"SOL",
	);

	// Derive the player PDA
	const [playerPda] = PublicKey.findProgramAddressSync(
		[Buffer.from("playerd"), payer.publicKey.toBuffer()],
		EXAMPLE_PROGRAM,
	);
	console.log("Player PDA:", playerPda.toBase58());

	// Step 1: Initialize player account (if not already)
	const playerAccount = await conn.getAccountInfo(playerPda);
	if (!playerAccount) {
		console.log("\n=== Initializing player account ===");
		const initDisc = anchorDisc("global", "initialize");
		const initIx = new TransactionInstruction({
			programId: EXAMPLE_PROGRAM,
			keys: [
				{ pubkey: payer.publicKey, isSigner: true, isWritable: true },
				{ pubkey: playerPda, isSigner: false, isWritable: true },
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			],
			data: initDisc,
		});
		const initSig = await sendAndConfirmTransaction(
			conn,
			new Transaction().add(initIx),
			[payer],
		);
		console.log("✅ Player initialized:", initSig);
	} else {
		console.log("Player account already exists, reading state...");
		const d = playerAccount.data;
		console.log("  last_result:", d[8]);
		console.log("  class:", d[9]);
		console.log("  atk:", d[10]);
		console.log("  def:", d[11]);
		console.log("  dex:", d[12]);
	}

	// Step 2: Roll dice (VRF request)
	console.log("\n=== Rolling dice (VRF request) ===");
	const [programIdentity] = PublicKey.findProgramAddressSync(
		[Buffer.from("identity")],
		EXAMPLE_PROGRAM,
	);
	console.log("Program identity PDA:", programIdentity.toBase58());

	const clientSeed = Math.floor(Math.random() * 256);
	const rollDisc = anchorDisc("global", "roll_dice");
	const rollData = Buffer.alloc(9);
	rollDisc.copy(rollData, 0);
	rollData.writeUInt8(clientSeed, 8);

	// Account order from their code: payer, player, oracle_queue + VRF appended: program_identity, vrf_program, slot_hashes, system_program
	// Actually the #[vrf] macro adds: program_identity, vrf_program, slot_hashes (system_program if not present)
	const rollIx = new TransactionInstruction({
		programId: EXAMPLE_PROGRAM,
		keys: [
			{ pubkey: payer.publicKey, isSigner: true, isWritable: true },
			{ pubkey: playerPda, isSigner: false, isWritable: false },
			{ pubkey: DEFAULT_QUEUE, isSigner: false, isWritable: true },
			{ pubkey: programIdentity, isSigner: false, isWritable: false },
			{ pubkey: VRF_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: SLOT_HASHES, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data: rollData,
	});

	const rollTx = new Transaction().add(
		ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
		rollIx,
	);

	try {
		const rollSig = await sendAndConfirmTransaction(conn, rollTx, [payer]);
		console.log("✅ Dice rolled! TX:", rollSig);

		// Poll player account for changes
		console.log("\n=== Polling for VRF callback (5 min) ===");
		const before = (await conn.getAccountInfo(playerPda))?.data;
		const startTime = Date.now();

		while (Date.now() - startTime < 5 * 60 * 1000) {
			const elapsed = Math.round((Date.now() - startTime) / 1000);
			const acc = await conn.getAccountInfo(playerPda);
			if (acc) {
				const d = acc.data;
				const changed = before && (d[8] !== before[8] || d[10] !== before[10]);
				console.log(
					`  [${elapsed}s] last_result=${d[8]}, class=${d[9]}, atk=${d[10]}, def=${d[11]}, dex=${d[12]}${changed ? " ← CHANGED!" : ""}`,
				);
				if (changed) {
					console.log(
						"\n🎉 VRF FULFILLED! Oracle is working for this program.",
					);
					return;
				}
			}
			await new Promise((r) => setTimeout(r, 10_000));
		}

		console.log("\n❌ VRF not fulfilled after 5 minutes");
	} catch (e: any) {
		console.log("❌ Roll dice failed:", e.message?.slice(0, 500));
		if (e.logs) e.logs.forEach((l: string) => console.log("  ", l));
	}
}

main().catch(console.error);
