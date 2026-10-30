import type { VercelRequest, VercelResponse } from '@vercel/node'
import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets'

const circleClient = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
})

/** Returns the wallet's most recent transactions so the browser can find the new tx hash. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const userToken = req.query.userToken as string
    const walletId = req.query.walletId as string
    if (!userToken || !walletId) return res.status(400).json({ error: 'userToken and walletId required' })

    const result = await circleClient.listTransactions({
      userToken,
      walletIds: [walletId],
      pageSize: 20,
    })
    const transactions = (result.data?.transactions ?? []).map(t => ({
      id: t.id,
      txHash: t.txHash ?? null,
      state: t.state,
    }))
    return res.status(200).json({ transactions })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
