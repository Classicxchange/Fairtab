# Household Bill Splitter

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

A USDC-based household bill splitter. One person creates a bill with a total amount, assigns each participant a fixed-USDC or percentage share, sets a payee (landlord, utility, etc.), an optional deadline, and an optional monthly recurrence. Participants pay their exact share directly into the contract. When fully funded, the payee claims via `claimPayout()`. Cancellation requires N-of-M votes; paid shares are refunded. Participants can also unilaterally reclaim their share after deadline expiry.

## Deployed Contracts

| Contract | Network | Address | Explorer |
|---|---|---|---|
| HouseholdBillSplitter v1 (single-pay) | Arc Testnet | 0xde23732dff462ed98141988ecd73a944a733391a | https://explorer.testnet.arc.io/address/0xde23732dff462ed98141988ecd73a944a733391a |
| HouseholdBillSplitter v2 (partial-pay) | Arc Testnet | 0x3d7bab3213fb65d98501fa4659340efffa49f621 | https://explorer.testnet.arc.io/address/0x3d7bab3213fb65d98501fa4659340efffa49f621 |
| HouseholdBillSplitter v3 (security hardened) | Arc Testnet | 0x96e92d600472e95c43981db0fab930c7a0c6aae7 | https://explorer.testnet.arc.io/address/0x96e92d600472e95c43981db0fab930c7a0c6aae7 |
| HouseholdBillSplitter v4 (full security audit) | Arc Testnet | 0xf250b0d7b2b47d6a70c2e68faed2f742abe4bf93 | https://explorer.testnet.arc.io/address/0xf250b0d7b2b47d6a70c2e68faed2f742abe4bf93 |
| HouseholdBillSplitter v5 (redirect hardened) | Arc Testnet | 0x037d5866d485bdfc2106dc0655b7ffd5227adef4 | https://explorer.testnet.arc.io/address/0x037d5866d485bdfc2106dc0655b7ffd5227adef4 |
| HouseholdBillSplitter v6 (label + share link + security) | Arc Testnet | 0xaed607435d81685d35682b9ed829e04888617db5 | https://explorer.testnet.arc.io/address/0xaed607435d81685d35682b9ed829e04888617db5 |
| HouseholdBillSplitter v7 (full security hardening: vote-change, recoverToken, redirect window, split-vote) | Arc Testnet | 0xdb58ca32df331cf4729ee8668d19cc254f2d9326 | https://explorer.testnet.arc.io/address/0xdb58ca32df331cf4729ee8668d19cc254f2d9326 |

| HouseholdBillSplitter v8 (mainnet, wrong USDC — superseded) | Arc Mainnet | 0x1C0ae34b80084EdC3F620c074f80b902eb310ad3 | https://explorer.arc.io/address/0x1C0ae34b80084EdC3F620c074f80b902eb310ad3 |
| HouseholdBillSplitter v9 (mainnet, correct USDC 0x3600 — superseded) | Arc Mainnet | 0xCEcb3C47CbD643B14b25D38ec4DB62dBcC6A4e3F | https://explorer.arc.io/address/0xCEcb3C47CbD643B14b25D38ec4DB62dBcC6A4e3F |
| HouseholdBillSplitter v10 (mainnet, superseded) | Arc Mainnet | 0x2d4c3580B6B3BD5f1aEa2f0CF04649ED558769C0 | https://explorer.arc.io/address/0x2d4c3580B6B3BD5f1aEa2f0CF04649ED558769C0 |
| HouseholdBillSplitter v11 (mainnet, ACTIVE — consent system: acceptInvite/rejectInvite/expireInvite/addParticipant, majority threshold, redirect quorum, MEV snapshot, deadline gate) | Arc Mainnet | 0x8cd4db9811d7beda48f18c34e92f0eb5baa9dfb2 | https://explorer.arc.io/address/0x8cd4db9811d7beda48f18c34e92f0eb5baa9dfb2 |

Constructor arg (testnet): USDC = `0x3600000000000000000000000000000000000000` (Arc Testnet)
Constructor arg (mainnet): USDC = `0x3600000000000000000000000000000000000000` (Arc Mainnet)

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
