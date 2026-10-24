import type { VercelRequest, VercelResponse } from '@vercel/node'
import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets'

const circleClient = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { deviceId, email } = req.body as { deviceId: string; email: string }
    if (!deviceId || !email) return res.status(400).json({ error: 'deviceId and email required' })

    // createDeviceTokenForEmailLogin returns device token + otp token for email OTP flow
    const result = await circleClient.createDeviceTokenForEmailLogin({ deviceId, email })
    return res.status(200).json(result.data)
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
