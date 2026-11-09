/**
 * GET /api/commit/yield?address=0x…&vault=0x…
 * Adds up what a wallet has put into and taken out of one of the Commit vaults, so the app can show
 * how much it has earned. Sources: Morpho's public API (full history) plus the chain itself for the most
 * recent blocks, because the API can lag behind by a little while.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createPublicClient, http, isAddress, parseAbi } from 'viem'

const VAULTS = [
  '0x10af7238c6355aa8ddb5ed60e2e9b55a72827b51',
  '0x7610094b846657dcf166d59e42973db52c7015f9',
  '0xbeef0016cb2fd5c352ea7ca08a9f54739dfa7298',
  '0x8e357432cc12ff425c36432f312968aeb16112af',
  '0xdeccd53be5453215821184824b519e04c7e00bc7',
  '0x5befab92a5a3d60f578cb51eeb4e4fd50a1e3123',
  '0xbeef00be37bde921bae06fad223125bab16c41d1',
  '0x05863f54b05e96092069ef30c9ca6060336e50b9',
  '0x389abdf4355e0cf4f19298179991705a98f21c18',
]
const RPC = 'https://rpc.mainnet.arc.io'
const RECENT_BLOCKS = 100_000n

const events = parseAbi([
  'event Deposit(address indexed sender, address indexed onBehalf, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed onBehalf, uint256 assets, uint256 shares)',
])

interface Item { key: string; type: 'Deposit' | 'Withdraw'; assets: bigint }

async function fromMorpho(user: string, vault: string): Promise<Item[] | null> {
  const out: Item[] = []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    for (let skip = 0; skip < 500; skip += 100) {
      const query = `{ vaultV2transactions(first: 100, skip: ${skip}, where: { chainId_in: [5042], vaultAddress_in: ["${vault}"], userAddress_in: ["${user}"] }) { items { type assets txHash logIndex } pageInfo { countTotal } } }`
      const r = await fetch('https://api.morpho.org/graphql', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }), signal: ctrl.signal,
      })
      if (!r.ok) return null
      const j = await r.json() as { data?: { vaultV2transactions?: { items: Array<{ type: string; assets: number | string; txHash: string; logIndex: number }>; pageInfo: { countTotal: number } } } }
      const page = j.data?.vaultV2transactions
      if (!page) return null
      for (const it of page.items) {
        if (it.type === 'Deposit' || it.type === 'Withdraw') {
          out.push({ key: `${it.txHash.toLowerCase()}:${it.type}:${it.logIndex}`, type: it.type, assets: BigInt(it.assets) })
        }
      }
      if (skip + 100 >= page.pageInfo.countTotal) break
    }
    return out
  } catch { return null } finally { clearTimeout(timer) }
}

async function fromChain(user: `0x${string}`, vault: `0x${string}`): Promise<Item[]> {
  const client = createPublicClient({ transport: http(RPC) })
  const latest = await client.getBlockNumber()
  const fromBlock = latest > RECENT_BLOCKS ? latest - RECENT_BLOCKS : 0n
  const [deps, wds] = await Promise.all([
    client.getLogs({ address: vault, event: events[0], args: { onBehalf: user }, fromBlock, toBlock: latest }),
    client.getLogs({ address: vault, event: events[1], args: { onBehalf: user }, fromBlock, toBlock: latest }),
  ])
  return [
    ...deps.map(l => ({ key: `${l.transactionHash.toLowerCase()}:Deposit:${l.logIndex}`, type: 'Deposit' as const, assets: l.args.assets ?? 0n })),
    ...wds.map(l => ({ key: `${l.transactionHash.toLowerCase()}:Withdraw:${l.logIndex}`, type: 'Withdraw' as const, assets: l.args.assets ?? 0n })),
  ]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const address = String(req.query.address ?? '')
  const vault = String(req.query.vault ?? '')
  if (!isAddress(address) || !isAddress(vault) || !VAULTS.includes(vault.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid address or vault.' })
  }
  try {
    const [api, chain] = await Promise.all([
      fromMorpho(address.toLowerCase(), vault.toLowerCase()),
      fromChain(address, vault as `0x${string}`).catch(() => [] as Item[]),
    ])
    // Merge by transaction so nothing is counted twice; the API may be missing the newest entries
    const merged = new Map<string, Item>()
    for (const it of api ?? []) merged.set(it.key, it)
    for (const it of chain) {
      const dup = [...merged.values()].some(m => m.type === it.type && m.assets === it.assets && m.key.split(':')[0] === it.key.split(':')[0])
      if (!dup) merged.set(it.key, it)
    }
    let deposited = 0n, withdrawn = 0n
    for (const it of merged.values()) { if (it.type === 'Deposit') deposited += it.assets; else withdrawn += it.assets }
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      deposited: deposited.toString(),
      withdrawn: withdrawn.toString(),
      complete: api !== null,
    })
  } catch {
    return res.status(502).json({ error: 'History is unavailable right now.' })
  }
}
