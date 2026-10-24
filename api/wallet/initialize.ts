import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  initiateUserControlledWalletsClient,
  Blockchain,
} from '@circle-fin/user-controlled-wallets'

const circleClient = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { userToken } = req.body as { userToken: string }
    if (!userToken) return res.status(400).json({ error: 'userToken required' })

    try {
      const initRes = await circleClient.createUserPinWithWallets({
        userToken,
        blockchains: [Blockchain.ARC],
      })
      return res.status(200).json({ challengeId: initRes.data?.challengeId })
    } catch (inner) {
      const code = (inner as { code?: number }).code
      if (code === 155106 || code === 155101) {
        return res.status(200).json({ alreadyInitialized: true })
      }
      throw inner
    }
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
