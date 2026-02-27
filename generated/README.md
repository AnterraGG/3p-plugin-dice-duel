# Generated Code

⚠️ **Do not edit files in this directory manually.**

Everything here is produced by build tools and will be overwritten.

## Contents

| Directory | Source | Generator | Command |
|---|---|---|---|
| `idl/` | `target/idl/` (Anchor build output) | `anchor build` | `pnpm build:svm` |
| `clients/svm/` | `idl/*.json` | Codama (`@codama/renderers-js`) | `pnpm codegen:svm` |

## Regenerating

After changing on-chain program/contract code:

```bash
# SVM: rebuild program → regenerate client
pnpm build:svm && pnpm codegen:svm

# Or rebuild everything:
pnpm build
```
