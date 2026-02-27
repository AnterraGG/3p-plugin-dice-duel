#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# anchor-build.sh — Self-contained Anchor build for the dice-duel plugin
#
# Solves the notorious "two target dirs" problem where `anchor build`
# outputs .so to programs/<name>/target/deploy/ AND target/deploy/
# with different keypairs, causing declare_id! mismatches on deploy.
#
# This script:
# 1. Reads the canonical program keypair (secrets dir or target/deploy/)
# 2. Syncs the keypair to BOTH target dirs before building
# 3. Runs `anchor keys sync` to update declare_id! in lib.rs
# 4. Builds the program (with memory-safe parallelism)
# 5. Copies IDL to generated/idl/
#
# Options:
#   --clean    Nuke ALL target dirs first (guarantees no stale .so)
#
# Usage: pnpm build:svm [-- --clean]
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PLUGIN_ROOT"

PROGRAM_NAME="dice_duel"
PROGRAM_DIR="programs/dice-duel"

# ─── Parse flags ────────────────────────────────────────────────────
CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=true ;;
  esac
done

# ─── Resolve canonical keypair ──────────────────────────────────────
# Priority: ANCHOR_DEPLOY_KEYPAIR env > secrets dir > target/deploy/
KEYPAIR_NAME="${PROGRAM_NAME}-keypair.json"
SECRETS_KEYPAIR="${ANCHOR_SECRETS_KEYPAIR:-}"
WORKSPACE_KEYPAIR="target/deploy/$KEYPAIR_NAME"
PROGRAM_KEYPAIR="$PROGRAM_DIR/target/deploy/$KEYPAIR_NAME"

if [[ -n "${ANCHOR_DEPLOY_KEYPAIR:-}" ]]; then
  CANONICAL_KEYPAIR="$ANCHOR_DEPLOY_KEYPAIR"
  echo "[anchor-build] Using keypair from ANCHOR_DEPLOY_KEYPAIR: $CANONICAL_KEYPAIR"
elif [[ -n "$SECRETS_KEYPAIR" && -f "$SECRETS_KEYPAIR" ]]; then
  CANONICAL_KEYPAIR="$SECRETS_KEYPAIR"
  echo "[anchor-build] Using secrets keypair: $CANONICAL_KEYPAIR"
elif [[ -f "$WORKSPACE_KEYPAIR" ]]; then
  CANONICAL_KEYPAIR="$WORKSPACE_KEYPAIR"
  echo "[anchor-build] Using workspace keypair: $CANONICAL_KEYPAIR"
elif [[ -f "$PROGRAM_KEYPAIR" ]]; then
  CANONICAL_KEYPAIR="$PROGRAM_KEYPAIR"
  echo "[anchor-build] Using program keypair: $CANONICAL_KEYPAIR"
else
  echo "[anchor-build] ERROR: No keypair found. Place $KEYPAIR_NAME in target/deploy/ or set ANCHOR_DEPLOY_KEYPAIR"
  exit 1
fi

PROGRAM_ID=$(solana-keygen pubkey "$CANONICAL_KEYPAIR")
echo "[anchor-build] Program ID: $PROGRAM_ID"

# ─── Clean if requested ────────────────────────────────────────────
if [[ "$CLEAN" == true ]]; then
  echo "[anchor-build] --clean: nuking ALL target dirs..."
  rm -rf target "$PROGRAM_DIR/target"
fi

# ─── Sync keypair to both target dirs ───────────────────────────────
mkdir -p "target/deploy"
mkdir -p "$PROGRAM_DIR/target/deploy"

[[ "$(realpath "$CANONICAL_KEYPAIR")" != "$(realpath "$WORKSPACE_KEYPAIR")" ]] && cp "$CANONICAL_KEYPAIR" "$WORKSPACE_KEYPAIR"
[[ "$(realpath "$CANONICAL_KEYPAIR")" != "$(realpath "$PROGRAM_KEYPAIR")" ]] && cp "$CANONICAL_KEYPAIR" "$PROGRAM_KEYPAIR"
echo "[anchor-build] Keypair synced to both target dirs"

# ─── Sync declare_id! in lib.rs ────────────────────────────────────
anchor keys sync
echo "[anchor-build] declare_id! synced"

# ─── Build ──────────────────────────────────────────────────────────
# Limit parallelism to avoid OOM on machines without swap
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
echo "[anchor-build] Building with CARGO_BUILD_JOBS=$CARGO_BUILD_JOBS..."
anchor build
echo "[anchor-build] Build complete"

# ─── Copy .so from program subdir → workspace target/deploy/ ───────
# anchor build MAY write the .so to programs/<name>/target/deploy/
# Ensure workspace target/deploy/ has the freshest copy
PROGRAM_SO="$PROGRAM_DIR/target/deploy/${PROGRAM_NAME}.so"
WORKSPACE_SO="target/deploy/${PROGRAM_NAME}.so"

if [[ -f "$PROGRAM_SO" ]]; then
  if [[ -f "$WORKSPACE_SO" ]]; then
    # Use the newer one
    if [[ "$PROGRAM_SO" -nt "$WORKSPACE_SO" ]]; then
      cp "$PROGRAM_SO" "$WORKSPACE_SO"
      echo "[anchor-build] Copied .so: $PROGRAM_SO → $WORKSPACE_SO (program dir was newer)"
    else
      echo "[anchor-build] Workspace .so is up to date"
    fi
  else
    cp "$PROGRAM_SO" "$WORKSPACE_SO"
    echo "[anchor-build] Copied .so: $PROGRAM_SO → $WORKSPACE_SO"
  fi
fi

# ─── Copy IDL to generated/ ────────────────────────────────────────
mkdir -p generated/idl
cp target/idl/*.json generated/idl/
echo "[anchor-build] IDL copied to generated/idl/"

# ─── Verify ─────────────────────────────────────────────────────────
BUILT_SIZE=$(stat -f%z "$WORKSPACE_SO" 2>/dev/null || stat -c%s "$WORKSPACE_SO")
echo "[anchor-build] ✅ Done — $PROGRAM_NAME.so ($BUILT_SIZE bytes) ready for deploy"
echo "[anchor-build] Deploy with: solana program deploy target/deploy/$PROGRAM_NAME.so --program-id $CANONICAL_KEYPAIR --url devnet"
