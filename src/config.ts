/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * NETWORK SWITCH
 * --------------
 * Set VITE_NETWORK=mainnet in .env to point the app at Arc Mainnet.
 * Leave it unset (or set to anything else) to use Arc Testnet.
 *
 * After changing VITE_NETWORK you MUST restart the dev server — Vite reads
 * env files only at startup.
 */

import { http } from 'wagmi'
import { mainnet, baseSepolia, arbitrumSepolia, sepolia, base } from 'wagmi/chains'
import { defineChain } from 'viem'
import { getDefaultConfig } from 'connectkit'
import { createConfig } from 'wagmi'
import { registerChain } from './tracing'

// ─── Arc chain definitions (from official docs.arc.io) ───────────────────────
// We define these manually because viem's built-in arcTestnet uses the wrong
// chain ID (4563). The canonical IDs per docs.arc.io are:
//   Mainnet:  5042     (https://docs.arc.io/arc/references/connect-to-arc.md)
//   Testnet:  5042002

export const arcTestnetChain = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://explorer.testnet.arc.io' },
  },
  testnet: true,
})

export const arcMainnetChain = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://explorer.arc.io' },
  },
})

// ─── Active network ───────────────────────────────────────────────────────────
export const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'
export const arcChain = IS_MAINNET ? arcMainnetChain : arcTestnetChain

// ─── wagmi config ─────────────────────────────────────────────────────────────
registerChain(arcChain.id, arcChain.rpcUrls.default.http[0])

// WalletConnect project ID — set VITE_WALLETCONNECT_PROJECT_ID in .env or
// Vercel env vars to enable WalletConnect. Without it MetaMask injected still works.
const wcProjectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? ''

const mainnetConfig = createConfig(
  getDefaultConfig({
    appName: 'Fairtab',
    walletConnectProjectId: wcProjectId,
    chains: [arcMainnetChain, base, mainnet],
    transports: {
      [arcMainnetChain.id]: http('https://rpc.mainnet.arc.io'),
      [base.id]:            http(),
      [mainnet.id]:         http(),
    },
  })
)

const testnetConfig = createConfig(
  getDefaultConfig({
    appName: 'Fairtab',
    walletConnectProjectId: wcProjectId,
    chains: [arcTestnetChain, baseSepolia, arbitrumSepolia, sepolia, mainnet],
    transports: {
      [arcTestnetChain.id]:  http('https://rpc.testnet.arc.io'),
      [baseSepolia.id]:      http(),
      [arbitrumSepolia.id]:  http(),
      [sepolia.id]:          http(),
      [mainnet.id]:          http(),
    },
  })
)

export const config = IS_MAINNET ? mainnetConfig : testnetConfig

// ─── Bridge chains ─────────────────────────────────────────────────────────────
export const BRIDGE_CHAINS = IS_MAINNET
  ? [
      { label: 'Arc',           chainId: arcMainnetChain.id, kitName: 'Arc'           },
      { label: 'Base',          chainId: base.id,            kitName: 'Base'           },
    ] as const
  : [
      { label: 'Arc Testnet',      chainId: arcTestnetChain.id,  kitName: 'Arc_Testnet'      },
      { label: 'Base Sepolia',     chainId: baseSepolia.id,       kitName: 'Base_Sepolia'     },
      { label: 'Arbitrum Sepolia', chainId: arbitrumSepolia.id,   kitName: 'Arbitrum_Sepolia' },
      { label: 'Ethereum Sepolia', chainId: sepolia.id,           kitName: 'Ethereum_Sepolia' },
    ] as const

export type BridgeChain = typeof BRIDGE_CHAINS[number]
