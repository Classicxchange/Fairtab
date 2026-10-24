import type { VercelRequest, VercelResponse } from '@vercel/node'
import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets'

const circleClient = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { deviceId } = req.body as { deviceId: string }
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' })

    const result = await circleClient.createUserTokenWithDeviceId({ deviceId })
    return res.status(200).json(result.data)
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
