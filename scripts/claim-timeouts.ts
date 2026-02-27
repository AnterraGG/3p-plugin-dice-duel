import * as crypto from "crypto";
import * as fs from "fs";
/**
 * Claim VRF timeout on stuck test wagers to reclaim escrow funds
 */
import {
	AccountRole,
	type Address,
	type IInstruction,
	type TransactionSigner,
	address,
	appendTransactionMessageInstruction,
	createKeyPairSignerFromBytes,
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	createTransactionMessage,
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
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_WS = "wss://api.devnet.solana.com";

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

	console.log("Admin:", admin.address);
	const { value: balanceBefore } = await rpc.getBalance(admin.address).send();
	console.log("Balance before:", Number(balanceBefore) / 1e9, "SOL\n");

	const challengers: Address[] = [
		address("CXj7MH4rA2Jd4CEfCWKyGUvGr4aw84GfeYkXq67M2wq"),
		address("4sZA9LQhAMhkfRr19SoNzb3793ZmSJM8YPcv78df8mut"),
	];

	for (const challengerPk of challengers) {
		const wagerPda = await pdaAddr([
			utf8.encode("wager"),
			addrEncoder.encode(challengerPk),
		]);
		const { value: wagerAcc } = await rpc
			.getAccountInfo(wagerPda, { encoding: "base64" })
			.send();
		if (!wagerAcc) {
			console.log(`No wager for ${challengerPk}`);
			continue;
		}

		// Parse opponent from wager: disc(8) + challenger(32) + opponent(32)
		const data = Buffer.from(wagerAcc.data[0] as string, "base64");
		const opponentBytes = data.subarray(40, 72);
		const opponentAddr = address(base58Decoder.decode(opponentBytes));

		const escrowPda = await pdaAddr([
			utf8.encode("escrow"),
			addrEncoder.encode(wagerPda),
		]);
		const configPda = await pdaAddr([utf8.encode("config")]);

		console.log(`Claiming VRF timeout for wager ${wagerPda}`);
		console.log(`  Challenger: ${challengerPk}`);
		console.log(`  Opponent: ${opponentAddr}`);

		const { value: escrowBal } = await rpc.getBalance(escrowPda).send();
		console.log(`  Escrow balance: ${Number(escrowBal) / 1e9} SOL`);

		const ix: IInstruction = {
			programAddress: PROGRAM_ID,
			accounts: [
				{
					address: admin.address,
					role: AccountRole.READONLY_SIGNER,
					signer: admin as TransactionSigner,
				},
				{ address: wagerPda, role: AccountRole.WRITABLE },
				{ address: escrowPda, role: AccountRole.WRITABLE },
				{ address: challengerPk, role: AccountRole.WRITABLE },
				{ address: opponentAddr, role: AccountRole.WRITABLE },
				{ address: configPda, role: AccountRole.READONLY },
				{ address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
			],
			data: disc("claim_vrf_timeout"),
		};

		try {
			const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
			const msg = createTransactionMessage({ version: "legacy" });
			const msg2 = setTransactionMessageFeePayer(admin.address, msg);
			const msg3 = setTransactionMessageLifetimeUsingBlockhash(
				latestBlockhash,
				msg2,
			);
			const msg4 = appendTransactionMessageInstruction(ix, msg3);
			const signed = await signTransactionMessageWithSigners(msg4);
			await sendAndConfirm(signed, { commitment: "confirmed" });
			const sig = getSignatureFromTransaction(signed);
			console.log(`  ✅ Claimed! TX: ${sig}`);
		} catch (e: any) {
			console.log(`  ❌ Failed: ${e.message?.slice(0, 300)}`);
		}
		console.log();
	}

	const { value: balanceAfter } = await rpc.getBalance(admin.address).send();
	console.log("Balance after:", Number(balanceAfter) / 1e9, "SOL");
}

main().catch(console.error);
