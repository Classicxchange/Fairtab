import { useReadContract } from 'wagmi'
import { FAIRID_ABI, FAIRID_ADDRESS } from '@/fairid'
import { arcChain } from '@/config'

/**
 * The FairID name claimed by a wallet, as plain text with no "@" sign, or undefined when
 * the wallet has none (or FairID is not available on this network).
 * It shares its cache with the FairID card, so a claim or release shows up
 * everywhere as soon as that card refreshes.
 */
export function useFairIdName(address?: string): string | undefined {
  const enabled = !!FAIRID_ADDRESS && !!address
  const { data } = useReadContract({
    address: FAIRID_ADDRESS,
    abi: FAIRID_ABI,
    functionName: 'nameOf',
    args: [address as `0x${string}`],
    chainId: arcChain.id,
    query: { enabled, refetchInterval: 30_000 },
  })
  const name = typeof data === 'string' ? data : ''
  return enabled && name ? name : undefined
}
