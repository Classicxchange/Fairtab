import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  initiateUserControlledWalletsClient,
  Blockchain,
} from '@circle-fin/user-controlled-wallets'

// Same network switch as the frontend: VITE_NETWORK=mainnet selects Arc Mainnet.
const ARC_CHAIN = process.env.VITE_NETWORK === 'mainnet' ? Blockchain.Arc : Blockchain.ArcTestnet

const circleClient = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const userToken = req.query.userToken as string
    if (!userToken) return res.status(400).json({ error: 'userToken required' })

    const result = await circleClient.listWallets({
      userToken,
      blockchain: ARC_CHAIN,
    })
    const all = result.data?.wallets ?? []

    // Put the wallet that holds the most USDC first (then the oldest), so a user with
    // several wallets always lands on the same, funded one.
    const withBalance = await Promise.all(all.map(async w => {
      let usdc = 0
      try {
        const bal = await circleClient.getWalletTokenBalance({ userToken, walletId: w.id })
        const entry = bal.data?.tokenBalances?.find(b => b.token?.symbol?.toUpperCase().startsWith('USDC'))
        usdc = entry ? parseFloat(entry.amount) || 0 : 0
      } catch { /* balance unavailable: treat as empty */ }
      return { id: w.id, address: w.address, usdc, created: Date.parse(w.createDate) || 0 }
    }))
    withBalance.sort((a, b) => (b.usdc - a.usdc) || (a.created - b.created))
    const wallets = withBalance.map(w => ({ id: w.id, address: w.address }))
    return res.status(200).json({ wallets })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
