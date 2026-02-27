/**
 * DiceDuel SVM Constants
 *
 * Well-known program IDs and addresses for the DiceDuel Anchor program.
 */

import type { Address } from "@solana/kit";

// ─── Program IDs ───────────────────────────────────────────────────────────

/** Metaplex Core program */
export const MPL_CORE_PROGRAM_ID =
	"CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" as Address;

/** MagicBlock VRF program */
export const VRF_PROGRAM_ID =
	"Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz" as Address;

/** VRF program identity PDA — signer in callbacks */
export const VRF_PROGRAM_IDENTITY =
	"9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw" as Address;

/** Base layer oracle queue (NOT ephemeral) */
export const DEFAULT_QUEUE =
	"Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh" as Address;

/** SlotHashes sysvar */
export const SLOT_HASHES_SYSVAR =
	"SysvarS1otHashes111111111111111111111111111" as Address;
