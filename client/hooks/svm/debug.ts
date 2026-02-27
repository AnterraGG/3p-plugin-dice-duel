/**
 * DiceDuel SVM Debug Utilities
 *
 * Provides transaction inspection and on-chain account verification
 * to help diagnose simulation errors before sending transactions.
 */

import type {
	SvmAccountMeta,
	SvmInstruction,
} from "@townexchange/3p-plugin-sdk/client";

// ─── Types ─────────────────────────────────────────────────────────────────

interface LabeledAccount {
	address: string;
	label: string;
}

interface AccountCheckResult {
	address: string;
	label: string;
	exists: boolean;
	owner?: string;
	dataLength?: number;
	error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function toHex(data: Uint8Array): string {
	return Array.from(data)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function explorerUrl(address: string, cluster?: string): string {
	const base = "https://explorer.solana.com/address/";
	const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
	return `${base}${address}${suffix}`;
}

// ─── Debug Transaction ────────────────────────────────────────────────────

/**
 * Logs detailed transaction info to the console for debugging.
 */
export function debugTransaction(
	label: string,
	instruction: SvmInstruction,
	accountLabels: LabeledAccount[],
	cluster?: string,
): void {
	const group = `[DiceDuel:debug] ${label}`;
	console.group(group);

	// Program
	console.log("Program:", instruction.programId);

	// Accounts table
	console.log("Accounts:");
	const accountsTable = instruction.accounts.map(
		(acc: SvmAccountMeta, i: number) => {
			const labelInfo = accountLabels[i];
			return {
				"#": i,
				label: labelInfo?.label ?? "?",
				address: acc.address,
				signer: acc.isSigner ? "✓" : "",
				writable: acc.isWritable ? "✓" : "",
				explorer: explorerUrl(acc.address, cluster),
			};
		},
	);
	console.table(accountsTable);

	// Instruction data
	const dataHex = toHex(instruction.data);
	console.log("Instruction data (hex):", dataHex);
	console.log("Discriminator:", dataHex.slice(0, 16));
	console.log("Args data:", dataHex.slice(16) || "(none)");
	console.log("Estimated size:", instruction.data.length, "bytes");

	// PDA explorer links
	console.log("Explorer links:");
	for (const la of accountLabels) {
		console.log(`  ${la.label}: ${explorerUrl(la.address, cluster)}`);
	}

	console.groupEnd();
}

// ─── Verify Accounts On-Chain ──────────────────────────────────────────────

/**
 * Checks which accounts exist on-chain using getMultipleAccounts RPC.
 * Logs results showing exists/not-found, owner, and data length.
 */
export async function verifyAccountsOnChain(
	rpcUrl: string,
	accounts: LabeledAccount[],
): Promise<AccountCheckResult[]> {
	const results: AccountCheckResult[] = [];

	try {
		const response = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "getMultipleAccounts",
				params: [accounts.map((a) => a.address), { encoding: "base64" }],
			}),
		});

		const json = await response.json();
		const values = json?.result?.value ?? [];

		console.group("[DiceDuel:verify] On-chain account check");
		for (let i = 0; i < accounts.length; i++) {
			const acc = accounts[i];
			const info = values[i];
			const result: AccountCheckResult = {
				address: acc.address,
				label: acc.label,
				exists: !!info,
			};
			if (info) {
				result.owner = info.owner;
				result.dataLength = info.data?.[0]
					? Buffer.from(info.data[0], "base64").length
					: 0;
			}
			results.push(result);
		}

		console.table(
			results.map((r) => ({
				label: r.label,
				address: r.address,
				status: r.exists ? "✅ EXISTS" : "❌ NOT FOUND",
				owner: r.owner ?? "-",
				dataLen: r.dataLength ?? "-",
			})),
		);
		console.groupEnd();
	} catch (err) {
		console.error("[DiceDuel:verify] RPC error:", err);
		for (const acc of accounts) {
			results.push({
				address: acc.address,
				label: acc.label,
				exists: false,
				error: String(err),
			});
		}
	}

	return results;
}
