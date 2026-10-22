# Fairtab Pre-Mainnet Security Review

**Date:** October 20, 2026  
**Scope:** Smart contract (HouseholdBillSplitter.sol) + frontend (src/) + API server (server/)  
**Severity tiers:** Critical / High / Medium / Low / Info

---

## Contract — Final Status: CLEAN

Two full max-depth passes (corpus rules + functional). No open findings.

Previous findings resolved across audit rounds:

| Round | Finding | Fix |
|---|---|---|
| 1 | Critical: redirect to precompile bricks payout | `_validatePayeeAddress` rejects 0x1–0x9 |
| 1 | High: redirect quorum unreachable (zero-contribution voters) | Eligibility broadened to any participant |
| 1 | High: creator redirect not one-time | `creatorRedirectUsed[billId]` enforces single use |
| 2 | Critical: candidate pinning locks settled funds | Per-candidate vote tracking (`payoutRedirectCandidateVotes`) |
| 2 | High: vote-splitting deadlock with one-shot votes | Vote-change mechanism (`_redirectVoteChoice`) |
| 2 | High: creator redirect had no time limit | Restricted to `settledAt + PAYOUT_REDIRECT_GRACE` window |
| 2 | High: `cancelThreshold` could exceed eligible redirect voters | Creation validates against nonzero-share count |
| 2 | Medium: no recovery for accidentally sent tokens | `recoverToken(token, to)` owner-only, sweeps surplus above `_totalReserved` |
| 2 | Medium: redundant no-op assignment | Removed |
| 3 | High: false-on-success ERC-20 return misclassification | Replaced low-level call with `try { safeTransfer(...) }` |

Acknowledged (no code fix warranted):
- Medium: shared custody USDC blocklist risk — documented via `protocolRiskAcknowledged()`

---

## Frontend + Server — Findings and Fixes Applied

### Critical (all fixed)

| # | Finding | Fix applied |
|---|---|---|
| C1 | `userToken` + `encryptionKey` persisted in `localStorage` — full wallet takeover on XSS | Removed from localStorage entirely; kept in React state (memory) only |
| C2 | Full session object including `encryptionKey` serialised to `localStorage` | Strip secrets before persist: only non-sensitive identity fields saved |

### High (all fixed)

| # | Finding | Fix applied |
|---|---|---|
| H1 | `Access-Control-Allow-Origin: *` on all server routes | Origin allowlist (`ALLOWED_ORIGINS`); wildcard replaced with exact-origin check |
| H2 | Payee + participant addresses not validated before contract call | `isAddress()` checks in `handleCreate`; clear error toasts on failure |
| H3 | Bridge destination address cast to `0x${string}` without validation | `isAddress()` check added to `handleBridge` |
| H4 | Unsanitized `deviceId` and `email` forwarded to Circle API | Manual type + format validation in server routes before forwarding |

### Medium (all fixed)

| # | Finding | Fix applied |
|---|---|---|
| M1 | Passkey credential in `localStorage` | Moved to `sessionStorage` (cleared on tab close) |
| M2 | Unhandled `throw` leaks server stack traces | Caught and replaced with generic 500 response; errors logged server-side only |
| M3 | No rate limiting on OTP / device-token endpoints | Per-IP token bucket: 5 req/min for OTP, 10 req/min for device-token, 20 req/min for others |
| M4 | No request body size limit | 64 KB cap in `readJson` |
| M5 | URL `?to=` prefill is a phishing vector | Warning banner rendered when Send form is pre-filled from URL params |
| M6 | `labelToBytes32` char-count truncation corrupts multi-byte chars | Switched to byte-accurate truncation via `TextEncoder` + `Uint8Array.slice(0, 32)` |

### Low (all fixed)

| # | Finding | Fix applied |
|---|---|---|
| L1 | `NOW_S` frozen at module load — stale deadline comparisons after long sessions | Replaced with `useNow()` hook, updates every 60 seconds |
| L2 | `TEST_API_KEY` fallback name inconsistent with convention | Server now prefers `CIRCLE_API_KEY`; `TEST_API_KEY` kept as legacy fallback |

---

## Remaining Action Required Before Mainnet (owner responsibility)

These cannot be fixed in code alone — they require infrastructure or Circle Console changes:

1. **Add your production domain to `ALLOWED_ORIGINS`** in `server/index.ts` before deploying. The list currently only allows `localhost`.

2. **Register authorized JavaScript origins in Google Cloud Console** for your `VITE_GOOGLE_CLIENT_ID` — exact domain, no wildcards.

3. **Register your production domain in Circle Console** for the App ID and Client Key.

4. **Rotate `TEST_API_KEY`** — it has been used in a development context where it may have appeared in logs. Create a fresh production key and set it as `CIRCLE_API_KEY`.

5. **Deploy the contract yourself from your own wallet** — Arc Studio cannot deploy to mainnet. Use `forge create` with your wallet on Arc Mainnet (chain ID 4562). Pass Arc Mainnet USDC address as constructor arg (verify on Circle docs before deploying).

6. **Update `CHAIN_ID`, `CONTRACT_ADDRESS`, `USDC_ADDRESS`, and the RPC URL** in `src/App.tsx` and `src/config.ts` to mainnet values after deployment.

7. **Consider an independent professional audit** before handling significant user funds on mainnet.

---

## Files Changed This Review

- `server/index.ts` — CORS lockdown, rate limiting, body size cap, input validation, error handling
- `src/AccountView.tsx` — removed secrets from localStorage/sessionStorage, passkey to sessionStorage
- `src/App.tsx` — address validation, URL prefill warning, labelToBytes32 fix, useNow hook
- `src/BridgeAndAuth.tsx` — isAddress validation on bridge destination
