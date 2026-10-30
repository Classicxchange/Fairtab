import { useCallback } from 'react'
import { useConfig } from 'wagmi'
import { disconnect } from 'wagmi/actions'
import { setCircleAuth } from '@/circleWallet'

/**
 * Disconnects every connected wallet (MetaMask, WalletConnect, Circle...).
 * wagmi can hold several connections at once, and disconnecting only the current
 * one would leave another wallet signed in.
 */
export function useDisconnectAll() {
  const config = useConfig()
  return useCallback(async () => {
    const connections = Array.from(config.state.connections.values())
    await Promise.allSettled(connections.map(c => disconnect(config, { connector: c.connector })))
    setCircleAuth(null)
  }, [config])
}
