# Fairtab — Arc Mainnet Deployment Guide

> Complete this checklist in order. Do not skip steps.

---

## Verified Network Parameters (from docs.arc.io)

| Parameter | Value |
|---|---|
| Chain ID | `5042` |
| RPC | `https://rpc.mainnet.arc.io` |
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| Explorer | `https://explorer.arc.io` |
| CCTP Domain | `26` |

**Same USDC address on testnet and mainnet** — no change needed in the contract constructor.

---

## Step 1 — Get mainnet USDC for gas

Arc uses USDC as the native gas token. You need USDC in your deployer wallet before you can deploy.

Options:
- Bridge from another chain via [Circle's CCTP bridge](https://developers.circle.com/cctp)
- Use Circle's Onramp (buy USDC with a bank card/wire)
- Transfer from a CEX that supports Arc (check exchange list at docs.arc.io)

A contract deployment costs roughly 0.01–0.05 USDC in gas. Keep at least 1 USDC in the deployer wallet.

---

## Step 2 — Install Arc Foundry

Arc requires arc-forge (Arc's Foundry fork) for correct gas estimation on mainnet.

```bash
# Install Arc Foundry
curl -L https://install.arc.io/foundry | bash
arc-foundryup

# Verify
arc-forge --version
```

> Standard `forge` works for compilation and tests but may produce incorrect gas estimates on Arc mainnet. Use `arc-forge` for the actual deploy.

---

## Step 3 — Deploy the contract

```bash
# From the project root:
arc-forge build

arc-forge create \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key YOUR_DEPLOYER_PRIVATE_KEY \
  contracts/HouseholdBillSplitter.sol:HouseholdBillSplitter \
  --constructor-args 0x3600000000000000000000000000000000000000
```

The output will include a `Deployed to:` address. Copy it.

> Never share or commit your private key. Use a hardware wallet (Ledger/Trezor) with `--ledger` instead of `--private-key` in production.

---

## Step 4 — Update the app

In `src/App.tsx`, replace the placeholder:

```ts
const MAINNET_CONTRACT = 'REPLACE_WITH_MAINNET_CONTRACT_ADDRESS' as const
```

With the deployed address:

```ts
const MAINNET_CONTRACT = '0xYOUR_DEPLOYED_ADDRESS' as const
```

In `AGENTS.md`, record the mainnet deployment:

```
HouseholdBillSplitter (Arc Mainnet, chain 5042): 0xYOUR_DEPLOYED_ADDRESS
```

---

## Step 5 — Switch the app to mainnet

In `.env`, add:

```
VITE_NETWORK=mainnet
VITE_APP_URL=https://yourdomain.com
```

Then restart the dev server (or rebuild for production):

```bash
# Dev
bun run dev

# Production build
bun run build
```

---

## Step 6 — Update Circle Console credentials

| Key | Action |
|---|---|
| `KIT_KEY` | Create a **production** Onramp Kit Key in [Circle Developer Console](https://console.circle.com). Add your production domain as an allowed origin. |
| `VITE_CLIENT_KEY` / `VITE_CLIENT_URL` | Create a **production** Modular Wallets client key. Add your production domain as allowed. |
| `VITE_CIRCLE_APP_ID` | Create a **production** User-Controlled Wallets app. |
| `TEST_API_KEY` → `CIRCLE_API_KEY` | Rename the env var; create a production Standard Developer API Key. |
| `VITE_GOOGLE_CLIENT_ID` | In Google Cloud Console, add your production domain to "Authorised JavaScript origins". |

---

## Step 7 — Update CORS

In `server/index.ts`, add your production domain to `ALLOWED_ORIGINS`:

```ts
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:4173',
  'https://yourdomain.com',   // ← add this
])
```

---

## Step 8 — Dry-run test on mainnet

Before announcing, run a complete flow end-to-end with small amounts:

1. Create a bill for 1 USDC between two wallets you control
2. Pay the full amount from wallet B
3. Verify the push payout lands in wallet A automatically (no manual claim needed)
4. Create a second bill, let it expire, then call `claimExpiredRefund`
5. Call `recoverToken` as the contract owner on a bill that has fully settled (to verify the surplus calculation)

Only proceed to public launch after all five steps succeed.

---

## Step 9 — Verify the contract on the explorer

```bash
arc-forge verify-contract \
  --rpc-url https://rpc.mainnet.arc.io \
  --verifier blockscout \
  --verifier-url https://explorer.arc.io/api \
  YOUR_DEPLOYED_ADDRESS \
  contracts/HouseholdBillSplitter.sol:HouseholdBillSplitter \
  --constructor-args $(cast abi-encode "constructor(address)" 0x3600000000000000000000000000000000000000)
```

A verified contract builds user trust and makes audit findings publicly attributable.

---

## Checklist before going public

- [ ] Contract deployed and address recorded in `src/App.tsx` and `AGENTS.md`
- [ ] `VITE_NETWORK=mainnet` in production `.env`
- [ ] All Circle Console credentials replaced with production keys
- [ ] `VITE_APP_URL` set to production domain in `.env` and `server/index.ts`
- [ ] CORS `ALLOWED_ORIGINS` contains production domain
- [ ] Google OAuth authorised origins updated
- [ ] Dry-run test completed (Step 8)
- [ ] Contract verified on explorer.arc.io
- [ ] Independent professional audit completed or scheduled
- [ ] `.env` is NOT committed to git (verify with `git status`)
