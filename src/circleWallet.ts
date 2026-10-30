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
import { formatUnits, numberToHex } from 'viem'
import type { W3SSdk as W3SSdkType } from '@circle-fin/w3s-pw-web-sdk'
import { arcChain } from '@/config'

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

const SESSION_EXPIRED =
  'Your Circle sign-in has expired. Sign out and sign in again to approve transactions.'

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
  if (!auth.userToken || !auth.encryptionKey) throw new Error(SESSION_EXPIRED)
  if (!tx.to) throw new Error('Contract deployment is not supported from a Circle wallet.')

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
    throw new Error(/token|expired|401/i.test(msg) ? SESSION_EXPIRED : msg)
  }

  // 2. Run the challenge: Circle's window asks the user for their PIN
  const sdk = await getSdk()
  sdk.setAuthentication({ userToken: auth.userToken, encryptionKey: auth.encryptionKey })
  await new Promise<void>((resolve, reject) => {
    sdk.execute(body.challengeId!, (error) => {
      if (error) reject(new Error((error as Error).message || 'Transaction was cancelled.'))
      else resolve()
    })
  })

  // 3. Find the new transaction's hash
  const known = new Set(body.knownTxIds ?? [])
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const r = await fetch(
      `/api/wallet/tx?userToken=${encodeURIComponent(auth.userToken)}&walletId=${encodeURIComponent(body.walletId)}`,
    )
    const t = await r.json() as { transactions?: { id: string; txHash: string | null; state: string }[] }
    const fresh = (t.transactions ?? []).find(x => !known.has(x.id))
    if (fresh) {
      if (['FAILED', 'DENIED', 'CANCELLED'].includes(fresh.state)) {
        throw new Error('The transaction was rejected by the network.')
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
  const json = await res.json() as { result?: unknown; error?: { message: string; code: number } }
  if (json.error) throw new Error(json.error.message)
  return json.result
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
