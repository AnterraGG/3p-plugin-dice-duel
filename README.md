# Dice Duel

On-chain dice duel game built on Solana with MagicBlock VRF for verifiable randomness.

## Structure

```
programs/dice-duel/   Anchor/Solana program (Rust)
client/               Client-side plugin code (TypeScript)
server/               Server-side plugin code (TypeScript)
shared/               Shared types, IDL, and generated Codama clients
scripts/              Dev/test/deploy scripts
e2e-test/             End-to-end test harness
runbooks/             Deployment runbooks (txtx)
```

## Environment Variables

| Variable | Used By | Description |
|---|---|---|
| `HELIUS_RPC_URL` | e2e tests, vrf-analysis | Helius RPC endpoint. Falls back to `https://api.devnet.solana.com`. |
| `SOLANA_KEYPAIR` | scripts, deploy, init, txtx.yml | Path to Solana keypair JSON file. Falls back to `~/.config/solana/id.json`. |
| `ADMIN_KEYPAIR_PATH` | e2e tests | Path to admin keypair JSON for test scripts. Falls back to `~/.config/solana/id.json`. |
| `ANCHOR_DEPLOY_KEYPAIR` | anchor-build.sh | Path to the program deploy keypair. Highest priority in the build script's keypair resolution. |
| `ANCHOR_SECRETS_KEYPAIR` | anchor-build.sh | Path to a secrets-dir keypair. Second priority after `ANCHOR_DEPLOY_KEYPAIR`. |
| `CARGO_BUILD_JOBS` | anchor-build.sh | Parallelism for `cargo build`. Defaults to `2` to avoid OOM. |

## Build

```bash
# Build Solana program + generate TypeScript clients
pnpm build

# Build only the Solana program
pnpm build:svm

# Regenerate Codama clients from IDL
pnpm codegen:svm

# Type-check TypeScript only
pnpm build:ts
```

## Deploy (devnet)

```bash
# Deploy the program binary
solana program deploy target/deploy/dice_duel.so \
  --program-id target/deploy/dice_duel-keypair.json \
  --url devnet

# Initialize GameConfig + register game types
npx tsx scripts/deploy-devnet.ts
```

## Test

```bash
# Anchor tests (localnet)
pnpm test:svm

# E2E test against devnet
HELIUS_RPC_URL="https://devnet.helius-rpc.com/?api-key=YOUR_KEY" \
ADMIN_KEYPAIR_PATH="/path/to/admin.json" \
  node e2e-test/test.mjs
```
