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

/**
 * Creates a Circle challenge for a raw contract call from the user's wallet.
 * The browser then runs the challenge, where the user enters their PIN.
 * Also returns the ids of the wallet's existing transactions so the browser can
 * tell which one is new once the PIN is confirmed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { userToken, walletAddress, to, data, amount } = req.body as {
      userToken?: string
      walletAddress?: string
      to?: string
      data?: string
      amount?: string
    }
    if (!userToken || !walletAddress || !to) {
      return res.status(400).json({ error: 'userToken, walletAddress and to are required' })
    }
    if (!data || !/^0x([0-9a-fA-F]{2})+$/.test(data)) {
      return res.status(400).json({ error: 'Only contract calls with call data are supported' })
    }

    const wallets = await circleClient.listWallets({ userToken, blockchain: ARC_CHAIN })
    const wallet = wallets.data?.wallets?.find(
      w => w.address.toLowerCase() === walletAddress.toLowerCase(),
    )
    if (!wallet) return res.status(404).json({ error: 'Wallet not found for this account' })

    const existing = await circleClient.listTransactions({
      userToken,
      walletIds: [wallet.id],
      pageSize: 20,
    })
    const knownTxIds = (existing.data?.transactions ?? []).map(t => t.id)

    const challenge = await circleClient.createUserTransactionContractExecutionChallenge({
      userToken,
      walletId: wallet.id,
      contractAddress: to,
      callData: data as `0x${string}`,
      ...(amount && amount !== '0' ? { amount } : {}),
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    })
    return res.status(200).json({
      challengeId: challenge.data?.challengeId,
      walletId: wallet.id,
      knownTxIds,
    })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}
