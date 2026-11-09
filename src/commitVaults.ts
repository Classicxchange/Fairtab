/**
 * The Morpho vaults shown on the Commit tab (Arc Mainnet). Every address was checked onchain:
 * the vault name matches and its asset is USDC or EURC with 6 decimals and 18-decimal shares.
 */
export type VaultAsset = 'USDC' | 'EURC'

export interface VaultInfo {
  id: string
  name: string
  curator: string
  asset: VaultAsset
  address: `0x${string}`
}

export const EURC_ADDRESS = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1' as const

export const COMMIT_VAULTS: VaultInfo[] = [
  { id: 'gauntlet-usdc-balanced', name: 'Gauntlet USDC Balanced', curator: 'Gauntlet', asset: 'USDC', address: '0x10AF7238C6355Aa8dDB5eD60E2e9b55a72827B51' },
  { id: 'bitwise-rwa-usdc', name: 'Bitwise Premium RWA USDC', curator: 'Bitwise', asset: 'USDC', address: '0x7610094B846657dCF166D59e42973db52c7015F9' },
  { id: 'steakhouse-prime-usdc', name: 'Steakhouse Prime USDC', curator: 'Steakhouse Financial', asset: 'USDC', address: '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298' },
  { id: 'galaxy-usdc', name: 'Galaxy USDC', curator: 'Galaxy Curation', asset: 'USDC', address: '0x8E357432CC12ff425c36432F312968aEb16112AF' },
  { id: 'gauntlet-usdc-prime', name: 'Gauntlet USDC Prime', curator: 'Gauntlet', asset: 'USDC', address: '0xdECcd53BE5453215821184824B519E04C7e00bC7' },
  { id: 'keyrock-prime-usdc', name: 'Keyrock Prime USDC', curator: 'Keyrock', asset: 'USDC', address: '0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123' },
  { id: 'steakhouse-prime-eurc', name: 'Steakhouse Prime EURC', curator: 'Steakhouse Financial', asset: 'EURC', address: '0xbeef00be37BdE921BAE06fad223125BAB16c41D1' },
  { id: 'gauntlet-eurc-prime', name: 'Gauntlet EURC Prime', curator: 'Gauntlet', asset: 'EURC', address: '0x05863F54B05e96092069eF30c9Ca6060336e50B9' },
  { id: 'galaxy-eurc', name: 'Galaxy EURC', curator: 'Galaxy Curation', asset: 'EURC', address: '0x389abDf4355e0cF4f19298179991705a98f21c18' },
]
