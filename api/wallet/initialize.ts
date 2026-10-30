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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { userToken } = req.body as { userToken: string }
    if (!userToken) return res.status(400).json({ error: 'userToken required' })

    try {
      const initRes = await circleClient.createUserPinWithWallets({
        userToken,
        blockchains: [ARC_CHAIN],
      })
      return res.status(200).json({ challengeId: initRes.data?.challengeId })
    } catch (inner) {
      const code = (inner as { code?: number }).code
      if (code === 155106 || code === 155101) {
        // The user already has a PIN (e.g. an earlier sign-in was interrupted before
        // the wallet was created). Ask for a wallet challenge instead of a new PIN.
        try {
          const walletRes = await circleClient.createWallet({
            userToken,
            blockchains: [ARC_CHAIN],
          })
          return res.status(200).json({ challengeId: walletRes.data?.challengeId })
        } catch {
          // A wallet already exists for this user: nothing left to create.
          return res.status(200).json({ alreadyInitialized: true })
        }
      }
      throw inner
    }
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
