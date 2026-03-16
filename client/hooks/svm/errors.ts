/**
 * DiceDuel Error Decoder
 *
 * Uses the SDK's universal Anchor error decoder combined with
 * Codama-generated custom error messages from the DiceDuel program.
 */

import {
	type DecodedAnchorError,
	createErrorDecoder,
} from "@townexchange/3p-plugin-sdk/anchor";
import {
	type DiceDuelError,
	getDiceDuelErrorMessage,
} from "#generated/clients/svm/dice-duel/errors";

export type { DecodedAnchorError };

const decodeError = createErrorDecoder((code: number) =>
	getDiceDuelErrorMessage(code as DiceDuelError),
);

/**
 * Decode a transaction error into a human-readable message.
 */
export function decodeDiceDuelError(error: unknown): DecodedAnchorError {
	return decodeError(error);
}

/**
 * Log a decoded error with full context for debugging.
 */
export function logDiceDuelError(
	context: string,
	error: unknown,
): DecodedAnchorError {
	const decoded = decodeError(error);
	const errorObj = error as Record<string, unknown>;
	const logs: string[] =
		(errorObj?.logs as string[]) ??
		((errorObj?.simulationResponse as Record<string, unknown>)
			?.logs as string[]) ??
		[];

	console.error(
		`[DiceDuel:${context}] ${decoded.name ?? "Error"} (code=${decoded.code ?? "?"}): ${decoded.message}`,
	);
	if (logs.length > 0) {
		console.error(`[DiceDuel:${context}] Transaction logs:`);
		for (const log of logs) {
			console.error(`  ${log}`);
		}
	}
	console.error(`[DiceDuel:${context}] Raw error:`, error);

	return decoded;
}
