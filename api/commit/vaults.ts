/**
 * GET /api/commit/vaults
 * Live yield and withdrawable liquidity for the vaults shown on the Commit tab.
 * Data comes from Morpho's public API. Only the fixed vault addresses below are ever queried.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

const ARC_MAINNET_CHAIN_ID = 5042
const VAULTS = [
  '0x10AF7238C6355Aa8dDB5eD60E2e9b55a72827B51', // Gauntlet USDC Balanced
  '0x7610094B846657dCF166D59e42973db52c7015F9', // Bitwise Premium RWA USDC
  '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298', // Steakhouse Prime USDC
  '0x8E357432CC12ff425c36432F312968aEb16112AF', // Galaxy USDC
  '0xdECcd53BE5453215821184824B519E04C7e00bC7', // Gauntlet USDC Prime
  '0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123', // Keyrock Prime USDC
  '0xbeef00be37BdE921BAE06fad223125BAB16c41D1', // Steakhouse Prime EURC
  '0x05863F54B05e96092069eF30c9Ca6060336e50B9', // Gauntlet EURC Prime
  '0x389abDf4355e0cF4f19298179991705a98f21c18', // Galaxy EURC
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const query = `{ vaultV2s(first: 20, where: { chainId_in: [${ARC_MAINNET_CHAIN_ID}], address_in: [${VAULTS.map(a => `"${a}"`).join(',')}] }) { items { address netApy liquidity totalAssets totalAssetsUsd liquidityUsd } } }`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    })
    if (!r.ok) throw new Error(`Morpho API ${r.status}`)
    const json = await r.json() as { data?: { vaultV2s?: { items?: Array<{ address: string; netApy: number | null; liquidity: string | number | null; totalAssets: string | number | null; totalAssetsUsd: number | null; liquidityUsd: number | null }> } } }
    const items = json.data?.vaultV2s?.items ?? []
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json({
      vaults: items.map(v => ({
        address: v.address,
        apy: typeof v.netApy === 'number' ? v.netApy : null,
        liquidity: v.liquidity != null ? String(v.liquidity) : null,
        totalAssets: v.totalAssets != null ? String(v.totalAssets) : null,
        tvlUsd: typeof v.totalAssetsUsd === 'number' ? v.totalAssetsUsd : null,
        liquidityUsd: typeof v.liquidityUsd === 'number' ? v.liquidityUsd : null,
      })),
    })
  } catch {
    return res.status(502).json({ error: 'Live vault data is unavailable right now.' })
  } finally {
    clearTimeout(timer)
  }
}
