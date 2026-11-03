# FairID design

Status: reviewed (two rounds) and tested. Target: Arc Testnet first. Mainnet is deployed by the owner.

## Goals
- A person claims one short, unique name for their wallet so others can pay the name instead of a long address.
- Free to claim, first come first served, no administrator.
- The contract only stores names. It never holds or moves money. The Fairtab app resolves a name here and sends USDC wallet to wallet itself.

## Non-goals
- No payments, fees, or tokens. No admin removal of names. No upgrades. No name marketplace.

## Rules
- Name: 3 to 20 bytes, each one of `a-z`, `0-9`, `_`. Case sensitive lowercase only. No other restriction.
- One name per wallet. A name has at most one owner.
- Release: the owner frees the name; for 30 days only the previous owner can claim it again.
- Move: two steps. The holder proposes a recipient, the recipient accepts. Nobody can push a name onto another wallet.

## Actors
| Actor | Trust | Can do |
| --- | --- | --- |
| Any wallet | untrusted | claim a free name, release or move its own name, read everything |
| App | off-chain | read names, then send USDC itself |

There is no owner, admin, pauser or upgrade key.

## Functions (write)
| Function | Caller | Effect | Reverts |
| --- | --- | --- | --- |
| `claim(name)` | anyone without a name | registers the name | InvalidName, NameTaken, AlreadyHasName, NameReserved |
| `release()` | name holder | frees the name, starts the 30 day reservation, clears any pending move | NoName |
| `proposeTransfer(to)` | name holder | records a pending move to `to` (replaces an earlier one) | NoName, ZeroAddress, SameAddress |
| `cancelTransfer()` | name holder | clears the pending move | NoPendingTransfer |
| `acceptTransfer(from)` | the proposed recipient | moves the name to the caller | NoPendingTransfer, RecipientHasName |

Views: `resolve`, `nameOf`, `isAvailable`, `isAvailableFor`, `isValidName`, `pendingTransferOf`, `ownerOf`, `previousOwner`, `releasedAt`.

## Security
| Risk | Status |
| --- | --- |
| Reentrancy | None: no external calls, no value |
| Access control | Each action only touches the caller's own name; a move needs the recipient's own acceptance |
| Griefing by pushing names onto others | Removed by the two-step move (found in review, fixed) |
| Name squatting / front-running | Accepted: first come first served; free names can be taken by anyone |
| Impersonation (look-alike names) | Accepted: only lowercase `a-z0-9_`, so no case or Unicode tricks; the app shows the full address before sending |
| Timestamp use | Only for the 30 day reservation; a few seconds of miner drift does not matter |
| Overflow | Solidity 0.8 checked arithmetic |

## Failure notes
- A pending move becomes invalid if the holder releases or changes name; acceptance then reverts.
- Names are unique per contract. A second deployment is a separate registry.

## Testing
- 57 FairID tests (including fuzz and an invariant) pass; the whole project suite passes (141 tests).
- Static analysis: only the expected timestamp notes and a compiler-version note.
- Reviewed twice; remaining notes are low severity (diagnostic detail in two error types).

## Claim fee (added for mainnet)

- Constructor: `FairID(IERC20 usdc_, address feeRecipient_, uint256 claimFee_)`. All three are immutable.
- Every successful `claim` pulls `claimFee` USDC with `safeTransferFrom` from the claimer straight to `feeRecipient`. The contract never holds tokens. No refunds, no admin, no setters.
- `claimFee_` must be above 0 (`FeeRequired`) and at most 100 USDC (`FeeTooHigh`). Intended value: 1 USDC = 1_000_000 base units (6 decimals).
- The recipient cannot be zero, the token, or the contract itself.
- Release, proposeTransfer, cancelTransfer and acceptTransfer are free.
- Known tradeoff: if the USDC issuer blocklists the fee recipient, every claim reverts forever. Choose a recipient accordingly.
- Deployment is done by the project owner from `/auth/admin` (FairID tab). The page checks the token, the recipient and the fee before deploying, and reads the three settings back afterwards. `VITE_FAIRID_MAINNET_ADDRESS` enables the feature in the app.
