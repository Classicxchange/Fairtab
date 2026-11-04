/**
 * CommitRouter: the small contract that takes Fairtab's commit fee and deposits the rest into a vault.
 * For mainnet, deploy it from /auth/admin and set VITE_COMMIT_ROUTER_ADDRESS. Until then the Commit tab
 * deposits straight into the vault and charges no fee.
 */
import { isAddress, parseAbi } from 'viem'

const configured = (import.meta.env.VITE_COMMIT_ROUTER_ADDRESS as string | undefined)?.trim()

export const COMMIT_ROUTER_ADDRESS: `0x${string}` | undefined =
  configured && isAddress(configured) ? configured : undefined

export const COMMIT_ROUTER_ABI = parseAbi([
  'function commit(address vault, uint256 assets, uint256 minShares) returns (uint256 shares)',
  'function previewCommit(uint256 assets) view returns (uint256 fee, uint256 net)',
  'function feeBps() view returns (uint16)',
  'function feeRecipient() view returns (address)',
  'function usdc() view returns (address)',
  'function isAllowedVault(address vault) view returns (bool)',
  'function vaults() view returns (address[])',
  'error VaultNotAllowed(address vault)',
  'error ZeroAmount()',
  'error SlippageExceeded(uint256 shares, uint256 minShares)',
  'error ShareDeliveryMismatch(uint256 reported, uint256 delivered)',
  'error LeftoverFunds()',
])
