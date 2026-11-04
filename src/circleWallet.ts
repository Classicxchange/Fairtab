/**
 * Circle wallet connector for wagmi.
 *
 * Makes a signed-in Circle (user-controlled) wallet look like any other wagmi
 * wallet, so every page that uses wagmi hooks (create bill, send, pay, claim...)
 * works unchanged. Transactions are sent as Circle challenges: the server creates
 * the challenge, the browser runs it (the user enters their PIN in Circle's own
 * window), then the transaction hash is looked up.
 *
 * Secrets (userToken, encryptionKey) are held in memory only.
 */

import { createConnector } from 'wagmi'
import { decodeErrorResult, erc20Abi, formatUnits, numberToHex } from 'viem'
import type { W3SSdk as W3SSdkType } from '@circle-fin/w3s-pw-web-sdk'
import { arcChain } from '@/config'
import artifact from '../contracts/out/HouseholdBillSplitter.sol/HouseholdBillSplitter.json'
import { FAIRID_ABI } from '@/fairid'
import { COMMIT_ROUTER_ABI } from '@/commitRouter'

const circleAppId = import.meta.env.VITE_CIRCLE_APP_ID as string | undefined
const RPC_URL = arcChain.rpcUrls.default.http[0]

interface CircleAuth {
  address: `0x${string}`
  userToken?: string
  encryptionKey?: string
}

let current: CircleAuth | null = null

export function setCircleAuth(auth: CircleAuth | null) {
  current = auth
}

let expiredHandler: (() => void) | null = null
/** The app registers what to do when the Circle sign-in has expired (sign the user out and ask them to sign in again). */
export function onCircleSessionExpired(handler: (() => void) | null) {
  expiredHandler = handler
}
function sessionExpired(): Error {
  expiredHandler?.()
  return new Error(SESSION_EXPIRED)
}

const SESSION_EXPIRED =
  'Your Circle sign-in has expired (it lasts about an hour). Sign out and sign in again. You will get the same wallet back.'

let sdkPromise: Promise<W3SSdkType> | null = null
function getSdk(): Promise<W3SSdkType> {
  if (!circleAppId) return Promise.reject(new Error('Circle is not configured (VITE_CIRCLE_APP_ID).'))
  sdkPromise ??= import('@circle-fin/w3s-pw-web-sdk').then(
    ({ W3SSdk }) => new W3SSdk({ appSettings: { appId: circleAppId } }),
  )
  return sdkPromise
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface TxParams {
  from?: string
  to?: string
  data?: string
  value?: string
}

async function sendCircleTransaction(tx: TxParams): Promise<`0x${string}`> {
  const auth = current
  if (!auth) throw new Error('No Circle wallet is connected.')
  if (!auth.userToken || !auth.encryptionKey) throw sessionExpired()
  if (!tx.to) throw new Error('Contract deployment is not supported from a Circle wallet.')

  await assertCallWouldSucceed(tx, auth.address)

  // 1. Ask the server for a challenge
  const value = tx.value && tx.value !== '0x0' ? BigInt(tx.value) : 0n
  const res = await fetch('/api/wallet/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userToken: auth.userToken,
      walletAddress: auth.address,
      to: tx.to,
      data: tx.data,
      amount: value > 0n ? formatUnits(value, 18) : undefined,
    }),
  })
  const body = await res.json() as {
    challengeId?: string; walletId?: string; knownTxIds?: string[]; error?: string
  }
  if (!res.ok || body.error || !body.challengeId || !body.walletId) {
    const msg = body.error ?? 'Could not start the transaction.'
    throw /userToken|expired|401/i.test(msg) ? sessionExpired() : new Error(msg)
  }

  // 2. Run the challenge: Circle's window asks the user for their PIN
  const sdk = await getSdk()
  sdk.setAuthentication({ userToken: auth.userToken, encryptionKey: auth.encryptionKey })
  await new Promise<void>((resolve, reject) => {
    sdk.execute(body.challengeId!, (error, result) => {
      if (error) {
        reject(new Error((error as Error).message || 'You closed the PIN window before confirming.'))
        return
      }
      const status = (result as { status?: string } | undefined)?.status
      if (status === 'FAILED' || status === 'EXPIRED') {
        reject(status === 'EXPIRED' ? sessionExpired() : new Error('Circle could not confirm your PIN. Please try again.'))
        return
      }
      resolve()
    })
  })

  // 3. Find the new transaction's hash
  const known = new Set(body.knownTxIds ?? [])
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const r = await fetch(
      `/api/wallet/tx?userToken=${encodeURIComponent(auth.userToken)}&walletId=${encodeURIComponent(body.walletId)}`,
    )
    const t = await r.json() as {
      transactions?: { id: string; txHash: string | null; state: string; errorReason?: string | null }[]
    }
    const fresh = (t.transactions ?? []).find(x => !known.has(x.id))
    if (fresh) {
      if (['FAILED', 'DENIED', 'CANCELLED'].includes(fresh.state)) {
        throw new Error(`Transaction failed${fresh.errorReason ? `: ${fresh.errorReason}` : ` (${fresh.state.toLowerCase()})`}. Make sure the wallet has enough USDC for network fees.`)
      }
      if (fresh.txHash) return fresh.txHash as `0x${string}`
    }
  }
  throw new Error('The transaction was submitted but its hash is not available yet. Check your wallet history.')
}

async function rpc(method: string, params: unknown[] | undefined) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
  })
  const json = await res.json() as { result?: unknown; error?: { message: string; code: number; data?: unknown } }
  if (json.error) {
    // Keep the revert data: it carries the contract's error name and reason.
    const data = typeof json.error.data === 'string' ? json.error.data : ''
    throw new Error(data ? `${json.error.message} ${data}` : json.error.message)
  }
  return json.result
}

const REASONS: Record<string, string> = {
  'duplicate participant': 'The same wallet address is listed twice. Each participant must be different.',
  'sum(amounts) must equal totalAmount': 'The participant amounts must add up to the total bill amount.',
  'sum(percentages) must equal 10000': 'The shares must add up to 10 000 bps (100%).',
  'bad threshold': 'The cancel votes setting is too high or too low for the number of participants.',
  'threshold below minimum majority': 'The cancel votes setting is too low. More than half of the participants must be needed to cancel.',
  'invalid payee: precompile': 'That payee address is not a normal wallet address.',
  'too many participants': 'Too many participants (the maximum is 20).',
  'participants/amounts length mismatch': 'Each participant needs an amount.',
  'totalAmount must be > 0': 'The total amount must be more than zero.',
  'percentage out of range': 'A share is above 10 000 bps (100%).',
}

const FRIENDLY_ERRORS: Record<string, string> = {
  InvalidName: 'FairIDs use 3 to 20 letters, numbers or underscores.',
  NameTaken: 'That FairID is already taken.',
  AlreadyHasName: 'This wallet already has a FairID. Release it first to pick another.',
  NoName: 'This wallet has no FairID.',
  NameReserved: 'That FairID was just released and is held for its previous owner for 30 days.',
  ZeroAddress: 'That address is not valid.',
  SameAddress: 'You cannot send a FairID to yourself.',
  RecipientHasName: 'The other wallet already has a FairID.',
  NoPendingTransfer: 'There is no pending FairID transfer to accept.',
  VaultNotAllowed: 'That vault is not supported.',
  ZeroAmount: 'Enter an amount above zero.',
  SlippageExceeded: 'The vault would give you fewer shares than expected. Try again in a moment.',
  ShareDeliveryMismatch: 'The vault did not deliver the expected shares, so nothing was sent.',
  LeftoverFunds: 'The vault did not accept the full amount, so nothing was sent.',
}

/** Dry-runs the call so a call that would revert shows a readable reason instead of failing after the PIN. */
async function assertCallWouldSucceed(tx: TxParams, from: string) {
  try {
    await rpc('eth_call', [{ from, to: tx.to, data: tx.data, value: tx.value }, 'latest'])
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const hex = raw.match(/0x[0-9a-fA-F]{8,}/)?.[0]
    if (hex) {
      try {
        const decoded = decodeErrorResult({
          abi: [...(artifact.abi as never[]), ...erc20Abi, ...FAIRID_ABI, ...COMMIT_ROUTER_ABI],
          data: hex as `0x${string}`,
        })
        const arg0 = typeof decoded.args?.[0] === 'string' ? decoded.args[0] : ''
        const errorName: string = decoded.errorName
        const friendly = FRIENDLY_ERRORS[errorName]
          ?? REASONS[arg0]
          ?? (errorName === 'InvalidBillParams' ? arg0 : errorName)
        throw new Error(`Not possible: ${friendly || errorName}`)
      } catch (inner) {
        if (inner instanceof Error && inner.message.startsWith('Not possible')) throw inner
      }
    }
    const plain = raw.replace(/^execution reverted:?\s*/i, '').replace(/0x[0-9a-fA-F]+/g, '').trim()
    throw new Error(`Cannot send this: the contract refused it${plain ? ` (${plain.slice(0, 100)})` : ''}. Check the details.`)
  }
}

const provider = {
  async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return current ? [current.address] : []
      case 'eth_chainId':
        return numberToHex(arcChain.id)
      case 'net_version':
        return String(arcChain.id)
      case 'wallet_switchEthereumChain':
        return null
      case 'eth_sendTransaction':
        return sendCircleTransaction((params?.[0] ?? {}))
      case 'personal_sign':
      case 'eth_sign':
      case 'eth_signTypedData_v4':
      case 'eth_signTransaction':
        throw new Error('Signing messages is not supported from a Circle wallet.')
      default:
        return rpc(method, params)
    }
  },
  on() { /* no events */ },
  removeListener() { /* no events */ },
}

export function circleConnector() {
  return createConnector<typeof provider>(() => ({
    id: 'circle-wallet',
    name: 'Circle Wallet',
    type: 'circle',
    setup() { return Promise.resolve() },
    connect() {
      if (!current) return Promise.reject(new Error('No Circle wallet is signed in.'))
      return Promise.resolve({ accounts: [current.address] as never, chainId: arcChain.id })
    },
    disconnect() { return Promise.resolve() },
    getAccounts() { return Promise.resolve(current ? [current.address] : []) },
    getChainId() { return Promise.resolve(arcChain.id) },
    getProvider() { return Promise.resolve(provider) },
    isAuthorized() { return Promise.resolve(!!current) },
    onAccountsChanged() { /* fixed account */ },
    onChainChanged() { /* fixed chain */ },
    onDisconnect() { /* handled by the app */ },
  }))
}
