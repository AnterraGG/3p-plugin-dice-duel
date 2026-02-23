import * as crypto from "crypto";
import * as fs from "fs";
/**
 * Quick devnet VRF test — mint bags, initiate wager, accept wager, poll for VRF fulfillment
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
		JSON.parse(fs.readFileSync("/home/node/.config/solana/id.json", "utf8")),
	);
	const admin = await createKeyPairSignerFromBytes(adminKey);

	// Create two test wallets
	const challenger = await generateKeyPairSigner();
	const opponent = await generateKeyPairSigner();

	console.log("Admin:", admin.address);
	console.log("Challenger:", challenger.address);
	console.log("Opponent:", opponent.address);

	// Fund test wallets from admin
	console.log("\n=== Funding wallets ===");
	const fundAmount = LAMPORTS_PER_SOL; // 1 SOL each

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
				const buf = Buffer.alloc(12);
				buf.writeUInt32LE(2, 0); // Transfer instruction index
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
	const fundSig = await buildAndSend(rpc, sendAndConfirm, fundIxs, admin);
	console.log("✅ Funded both wallets, tx:", fundSig);

	// PDAs
	const configPda = await pdaAddr([utf8.encode("config")]);
	const gameTypePda = await pdaAddr([
		utf8.encode("game_type"),
		new Uint8Array([0]),
	]);

	// Mint dice bag for challenger
	console.log("\n=== Minting dice bag for challenger ===");
	const mintKp = await generateKeyPairSigner();
	const diceBagPda = await pdaAddr([
		utf8.encode("dice_bag"),
		addrEncoder.encode(mintKp.address),
	]);

	const mintIx: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: challenger.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: challenger,
			},
			{ address: configPda, role: AccountRole.WRITABLE },
			{
				address: mintKp.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: mintKp,
			},
			{ address: diceBagPda, role: AccountRole.WRITABLE },
			{ address: TREASURY, role: AccountRole.WRITABLE },
			{ address: MPL_CORE, role: AccountRole.READONLY },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
		],
		data: disc("mint_dice_bag"),
	};
	const mintSig = await buildAndSend(rpc, sendAndConfirm, [mintIx], challenger);
	console.log("✅ Dice bag minted, tx:", mintSig);

	// Initiate wager
	console.log("\n=== Initiating wager ===");
	const wagerPda = await pdaAddr([
		utf8.encode("wager"),
		addrEncoder.encode(challenger.address),
	]);
	const escrowPda = await pdaAddr([
		utf8.encode("escrow"),
		addrEncoder.encode(wagerPda),
	]);

	// Borsh: opponent (32) + amount (8) + game_type (1) + challenger_choice (1)
	const initData = Buffer.alloc(8 + 32 + 8 + 1 + 1);
	disc("initiate_wager").forEach((b, i) => (initData[i] = b));
	const amount = LAMPORTS_PER_SOL / 10n; // 0.1 SOL
	Buffer.from(addrEncoder.encode(opponent.address)).copy(initData, 8);
	initData.writeBigUInt64LE(amount, 40);
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
			{ address: diceBagPda, role: AccountRole.WRITABLE },
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

	// Accept wager (triggers VRF)
	console.log("\n=== Accepting wager (VRF request) ===");
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

	// Mint dice bag for opponent too
	const mintKp2 = await generateKeyPairSigner();
	const opponentBagPda = await pdaAddr([
		utf8.encode("dice_bag"),
		addrEncoder.encode(mintKp2.address),
	]);

	const mintIx2: IInstruction = {
		programAddress: PROGRAM_ID,
		accounts: [
			{
				address: opponent.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: opponent,
			},
			{ address: configPda, role: AccountRole.WRITABLE },
			{
				address: mintKp2.address,
				role: AccountRole.WRITABLE_SIGNER,
				signer: mintKp2,
			},
			{ address: opponentBagPda, role: AccountRole.WRITABLE },
			{ address: TREASURY, role: AccountRole.WRITABLE },
			{ address: MPL_CORE, role: AccountRole.READONLY },
			{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
		],
		data: disc("mint_dice_bag"),
	};
	const mintSig2 = await buildAndSend(rpc, sendAndConfirm, [mintIx2], opponent);
	console.log("✅ Opponent dice bag minted, tx:", mintSig2);

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
			{ address: diceBagPda, role: AccountRole.WRITABLE },
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

	try {
		const acceptSig = await buildAndSend(
			rpc,
			sendAndConfirm,
			[acceptIx],
			opponent,
		);
		console.log("✅ Wager accepted! VRF requested. TX:", acceptSig);

		// Now poll the wager account to see if VRF fulfills
		console.log("\n=== Polling for VRF fulfillment (5 min max) ===");
		const startTime = Date.now();
		const maxWaitMs = 5 * 60 * 1000;

		while (Date.now() - startTime < maxWaitMs) {
			const { value: wagerAccount } = await rpc
				.getAccountInfo(wagerPda, { encoding: "base64" })
				.send();
			if (wagerAccount) {
				const data = Buffer.from(wagerAccount.data[0] as string, "base64");
				const elapsed = Math.round((Date.now() - startTime) / 1000);

				// Quick parse: disc(8) + challenger(32) + opponent(32) + amount(8) + game_type(1) + challenger_choice(1) + status(1)
				const statusByte = data[8 + 32 + 32 + 8 + 1 + 1];
				const statusMap: Record<number, string> = {
					0: "Pending",
					1: "Accepted",
					2: "Resolved",
					3: "Expired",
					4: "Cancelled",
				};
				const statusName = statusMap[statusByte] || `Unknown(${statusByte})`;

				console.log(
					`  [${elapsed}s] Wager status: ${statusName} (byte=${statusByte})`,
				);

				if (statusByte >= 2) {
					console.log("\n🎉 VRF FULFILLED! Wager resolved!");
					// Try to read the result
					const rollByte = data[8 + 32 + 32 + 8 + 1 + 1 + 1]; // next byte might be the roll
					console.log("   Roll value (maybe):", rollByte);
					break;
				}
			}

			await new Promise((r) => setTimeout(r, 10_000)); // poll every 10s
		}

		if (Date.now() - startTime >= maxWaitMs) {
			console.log("\n❌ VRF not fulfilled after 5 minutes");
		}
	} catch (e: any) {
		console.log("❌ Accept wager failed:", e.message?.slice(0, 500));
	}
}

main().catch(console.error);
