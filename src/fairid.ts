/**
 * FairID registry: a separate contract that links a short name to a wallet.
 * Testnet address is live. For mainnet, deploy the contract and set VITE_FAIRID_MAINNET_ADDRESS.
 */
import { parseAbi, isAddress } from 'viem'
import { IS_MAINNET } from '@/config'

const TESTNET_FAIRID = '0xca6b7fea9e936c793e63d0a7aab1f46e55b3d53c'
const mainnetValue = (import.meta.env.VITE_FAIRID_MAINNET_ADDRESS as string | undefined)?.trim()

export const FAIRID_ADDRESS: `0x${string}` | undefined = IS_MAINNET
  ? (mainnetValue && isAddress(mainnetValue) ? mainnetValue : undefined)
  : TESTNET_FAIRID

export const FAIRID_ABI = parseAbi([
  'function claim(string name)',
  'function release()',
  'function proposeTransfer(address to)',
  'function cancelTransfer()',
  'function acceptTransfer(address from)',
  'function claimFee() view returns (uint256)',
  'function usdc() view returns (address)',
  'function resolve(string name) view returns (address wallet)',
  'function nameOf(address wallet) view returns (string name)',
  'function isAvailableFor(string name, address who) view returns (bool available)',
  'function isValidName(string name) pure returns (bool valid)',
  'function pendingTransferOf(address from) view returns (address to, bytes32 nameHash)',
  'error InvalidName()',
  'error NameTaken(bytes32 nameHash)',
  'error AlreadyHasName()',
  'error NoName()',
  'error NameReserved(bytes32 nameHash, address previousOwner)',
  'error ZeroAddress()',
  'error SameAddress()',
  'error RecipientHasName(address recipient)',
  'error NoPendingTransfer()',
  'error FeeRequired()',
  'error FeeTooHigh(uint256 fee, uint256 max)',
  'error InvalidFeeRecipient()',
])

/** Names are 3 to 20 characters: a-z, 0-9 and underscore. */
export const FAIRID_NAME_PATTERN = /^[a-z0-9_]{3,20}$/

/** Turns "@Tunde", " tunde " and "tunde" into the canonical lowercase name. */
export function cleanFairId(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase()
}
