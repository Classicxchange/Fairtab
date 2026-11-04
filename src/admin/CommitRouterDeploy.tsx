/**
 * Commit router deploy section for /auth/admin.
 * You deploy from your own wallet. Nothing here is signed or sent for you.
 */
import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { createPublicClient, getContractAddress, http, isAddress, parseAbi } from 'viem'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, Rocket, ShieldCheck, XCircle } from 'lucide-react'
import { arcMainnetChain, arcTestnetChain, IS_MAINNET } from '@/config'
import { buildAddressExplorerUrl, getUsdc } from '@/onchain-facts'
import { COMMIT_ROUTER_ADDRESS } from '@/commitRouter'
import artifact from '../../contracts/out/CommitRouter.sol/CommitRouter.json'

const chain = IS_MAINNET ? arcMainnetChain : arcTestnetChain
const CANONICAL_USDC = getUsdc(chain.id)?.address ?? ''
const DEFAULT_VAULTS = IS_MAINNET
  ? ['0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298', '0x8E357432CC12ff425c36432F312968aEb16112AF']
  : []

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)' }
const input: React.CSSProperties = { background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--ink)' }

type Level = 'ok' | 'warn' | 'fail'
interface Check { level: Level; text: string }

const tokenAbi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function isBlacklisted(address) view returns (bool)'])
const vaultAbi = parseAbi(['function asset() view returns (address)', 'function name() view returns (string)', 'function decimals() view returns (uint8)'])
const routerAbi = parseAbi([
  'function usdc() view returns (address)', 'function feeRecipient() view returns (address)', 'function feeBps() view returns (uint16)',
  'function isAllowedVault(address) view returns (bool)',
])

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))) })
  })
}

export function CommitRouterDeploySection({ adminAddress }: { adminAddress: string }) {
  const [usdc, setUsdc] = useState(CANONICAL_USDC)
  const [recipient, setRecipient] = useState('')
  const [bpsText, setBpsText] = useState('23')
  const [vaultsText, setVaultsText] = useState(DEFAULT_VAULTS.join('\n'))
  const [checks, setChecks] = useState<Check[]>([])
  const [checkedKey, setCheckedKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [stage, setStage] = useState('')
  const [txHash, setTxHash] = useState('')
  const [deployed, setDeployed] = useState('')
  const [verify, setVerify] = useState<Check[]>([])
  const [verifyFailed, setVerifyFailed] = useState(false)
  const [error, setError] = useState('')
  const deployedRef = useRef('')
  const { chainId: walletChainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()

  const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
  const bytecode = ((artifact.bytecode as unknown as { object?: string }).object ?? '') as `0x${string}`

  const bpsOk = /^\d{1,3}$/.test(bpsText.trim()) && Number(bpsText) >= 1 && Number(bpsText) <= 100
  const bps = bpsOk ? Number(bpsText) : 0
  const vaults = vaultsText.split(/[\s,]+/).map(v => v.trim()).filter(Boolean)
  const settingsKey = `${usdc.toLowerCase()}|${recipient.toLowerCase()}|${bps}|${vaults.map(v => v.toLowerCase()).join(',')}`

  const runChecks = async () => {
    const keyAtStart = settingsKey
    setChecking(true); setChecks([]); setCheckedKey('')
    const out: Check[] = []
    try {
      if (!isAddress(usdc)) out.push({ level: 'fail', text: 'USDC address is not a valid address.' })
      if (!isAddress(recipient)) out.push({ level: 'fail', text: 'Fee recipient is not a valid address.' })
      if (!bpsOk) out.push({ level: 'fail', text: 'Fee must be a whole number of basis points from 1 to 100 (23 = 0.23%).' })
      if (vaults.length === 0 || vaults.length > 10) out.push({ level: 'fail', text: 'Add between 1 and 10 vault addresses.' })
      if (vaults.some(v => !isAddress(v))) out.push({ level: 'fail', text: 'One of the vault addresses is not valid.' })
      if (new Set(vaults.map(v => v.toLowerCase())).size !== vaults.length) out.push({ level: 'fail', text: 'A vault address is listed twice.' })
      if (out.some(c => c.level === 'fail')) { setChecks([...out]); return }

      if (!CANONICAL_USDC) out.push({ level: 'fail', text: `Fairtab has no verified USDC address for ${chain.name}, so this deployment is blocked.` })
      else if (usdc.toLowerCase() !== CANONICAL_USDC.toLowerCase()) out.push({ level: 'fail', text: `This is not the USDC address Fairtab expects on ${chain.name} (${CANONICAL_USDC}). Deployment is blocked.` })
      else out.push({ level: 'ok', text: `USDC address matches the one Fairtab expects on ${chain.name}.` })

      try {
        const [sym, dec] = await Promise.all([
          client.readContract({ address: usdc as `0x${string}`, abi: tokenAbi, functionName: 'symbol' }),
          client.readContract({ address: usdc as `0x${string}`, abi: tokenAbi, functionName: 'decimals' }),
        ])
        out.push({ level: sym === 'USDC' && dec === 6 ? 'ok' : 'fail', text: `Token reports symbol ${sym} and ${dec} decimals${sym === 'USDC' && dec === 6 ? '.' : ' (expected USDC with 6).'}` })
      } catch { out.push({ level: 'fail', text: 'The USDC address did not answer symbol() and decimals().' }) }

      for (const v of vaults) {
        try {
          const [asset, name] = await Promise.all([
            client.readContract({ address: v as `0x${string}`, abi: vaultAbi, functionName: 'asset' }),
            client.readContract({ address: v as `0x${string}`, abi: vaultAbi, functionName: 'name' }),
          ])
          out.push({ level: asset.toLowerCase() === usdc.toLowerCase() ? 'ok' : 'fail', text: `Vault ${v.slice(0, 8)}…${v.slice(-4)} is "${name}" and ${asset.toLowerCase() === usdc.toLowerCase() ? 'holds USDC.' : 'does NOT hold this USDC.'}` })
        } catch { out.push({ level: 'fail', text: `Vault ${v} did not answer asset() and name(). It is not a supported vault.` }) }
        if (v.toLowerCase() === recipient.toLowerCase()) out.push({ level: 'fail', text: 'The fee recipient cannot be one of the vaults.' })
      }

      const rec = recipient.toLowerCase()
      if (rec === usdc.toLowerCase()) out.push({ level: 'fail', text: 'The fee recipient cannot be the USDC token itself.' })
      if (BigInt(recipient) < 0x10000n) out.push({ level: 'fail', text: 'The fee recipient looks like a system or precompile address. Use a normal wallet.' })
      try {
        const bl = await client.readContract({ address: usdc as `0x${string}`, abi: tokenAbi, functionName: 'isBlacklisted', args: [recipient as `0x${string}`] })
        out.push({ level: bl ? 'fail' : 'ok', text: bl ? 'The fee recipient is blocklisted by the USDC issuer. Commits would fail forever.' : 'The fee recipient is not blocklisted right now.' })
      } catch { out.push({ level: 'warn', text: 'Could not check the USDC blocklist. If the recipient is ever blocklisted, every commit fails and cannot be fixed.' }) }
      out.push({ level: 'warn', text: 'The fee, recipient and vault list are fixed forever once deployed. Deployed vaults can still change how they behave, so only list vaults you have reviewed.' })
    } catch (e) {
      out.push({ level: 'fail', text: `Checks failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` })
    } finally {
      setChecks([...out]); setCheckedKey(keyAtStart); setChecking(false)
    }
  }

  const checksPassed = checks.length > 0 && !checks.some(c => c.level === 'fail') && checkedKey === settingsKey && !checking
  const canDeploy = checksPassed && confirmText === 'DEPLOY' && !deploying && !deployed

  const handleDeploy = async () => {
    setDeploying(true); setError('')
    try {
      if (!walletClient) throw new Error('Your wallet is not ready. Reconnect it and try again.')
      if (walletChainId !== chain.id) { setStage(`Switch your wallet to ${chain.name}…`); await switchChainAsync({ chainId: chain.id }) }
      setStage('Confirm the deployment in your wallet…')
      const hash = await withTimeout(
        walletClient.deployContract({
          abi: artifact.abi, bytecode,
          args: [usdc as `0x${string}`, recipient as `0x${string}`, bps, vaults as `0x${string}`[]],
          account: adminAddress as `0x${string}`, chain,
        }),
        90_000, 'Your wallet did not respond. Open your wallet app or extension, look for a pending request, then try again.',
      )
      setTxHash(hash); setStage('Waiting for the network to confirm…')
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 })
      if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Deployment transaction failed.')
      const addr = receipt.contractAddress
      setDeployed(addr); deployedRef.current = addr; setVerifyFailed(false)

      const [u, r, f] = await Promise.all([
        client.readContract({ address: addr, abi: routerAbi, functionName: 'usdc' }),
        client.readContract({ address: addr, abi: routerAbi, functionName: 'feeRecipient' }),
        client.readContract({ address: addr, abi: routerAbi, functionName: 'feeBps' }),
      ])
      const allowed = await Promise.all(vaults.map(v => client.readContract({ address: addr, abi: routerAbi, functionName: 'isAllowedVault', args: [v as `0x${string}`] })))
      const results: Check[] = [
        { level: u.toLowerCase() === usdc.toLowerCase() ? 'ok' : 'fail', text: `usdc() = ${u}` },
        { level: r.toLowerCase() === recipient.toLowerCase() ? 'ok' : 'fail', text: `feeRecipient() = ${r}` },
        { level: Number(f) === bps ? 'ok' : 'fail', text: `feeBps() = ${f} (${(Number(f) / 100).toFixed(2)}%)` },
        ...vaults.map((v, i) => ({ level: (allowed[i] ? 'ok' : 'fail') as Level, text: `isAllowedVault(${v.slice(0, 8)}…${v.slice(-4)}) = ${String(allowed[i])}` })),
      ]
      setVerify(results)
      if (results.some(c => c.level === 'fail')) { setVerifyFailed(true); toast.error('Deployed, but the settings read back do not match. Do not use this contract.') }
      else toast.success('Commit router deployed and verified')
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).slice(0, 220))
      if (deployedRef.current) setVerifyFailed(true)
      toast.error(deployedRef.current ? 'Deployed, but could not verify the settings' : 'Deployment failed')
    } finally { setDeploying(false); setStage('') }
  }

  const icon = (l: Level) => l === 'ok'
    ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
    : l === 'warn' ? <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
    : <XCircle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
  const lock = checking || deploying || !!deployed

  return (
    <motion.div className="flex flex-col gap-5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Deploy Commit router</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Takes the commit fee and deposits the rest into the listed vaults. Deployed to {chain.name} from your own wallet.</p>
      </div>
      {IS_MAINNET && (
        <div className="rounded-2xl p-4 text-xs leading-relaxed" style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning)', color: 'var(--ink-2)' }}>
          <strong>Mainnet uses real funds and cannot be undone.</strong> The fee, the fee recipient and the vault list are fixed forever. Arc Studio does not deploy for you. Review every value yourself, and have the contract independently audited before real users' money goes through it.
        </div>
      )}
      <div className="p-5 rounded-2xl flex flex-col gap-4" style={card}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>USDC token address</label>
          <input value={usdc} disabled={lock} onChange={e => { setUsdc(e.target.value.trim()); setChecks([]) }} className="mono rounded-xl px-4 py-2.5 text-sm outline-none" style={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Fee recipient (you choose, no default)</label>
          <input value={recipient} disabled={lock} onChange={e => { setRecipient(e.target.value.trim()); setChecks([]) }} placeholder="0x… wallet that receives every fee" className="mono rounded-xl px-4 py-2.5 text-sm outline-none" style={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Fee in basis points (23 = 0.23%, max 100)</label>
          <input value={bpsText} disabled={lock} onChange={e => { setBpsText(e.target.value); setChecks([]) }} inputMode="numeric" className="rounded-xl px-4 py-2.5 text-sm outline-none" style={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Allowed vaults (one address per line)</label>
          <textarea value={vaultsText} disabled={lock} onChange={e => { setVaultsText(e.target.value); setChecks([]) }} rows={3} className="mono rounded-xl px-4 py-2.5 text-xs outline-none" style={input} />
        </div>
        <button onClick={() => { void runChecks() }} disabled={checking || deploying} className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
          {checking ? <><Loader2 className="size-4 animate-spin" /> Checking…</> : <><ShieldCheck className="size-4" /> Check these settings</>}
        </button>
        {checks.length > 0 && (
          <div className="flex flex-col gap-2">
            {checks.map(c => (<div key={c.text} className="flex items-start gap-2 text-xs" style={{ color: 'var(--ink-2)' }}>{icon(c.level)}<span>{c.text}</span></div>))}
          </div>
        )}
      </div>
      <div className="p-5 rounded-2xl flex flex-col gap-3" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Deploy</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Type <span className="mono font-bold">DEPLOY</span> to confirm. Your wallet will then ask you to sign from {adminAddress.slice(0, 8)}…{adminAddress.slice(-6)}.</p>
        <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="DEPLOY" className="mono rounded-xl px-4 py-2.5 text-sm outline-none" style={input} />
        <button onClick={() => { void handleDeploy() }} disabled={!canDeploy} className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
          {deploying ? <><Loader2 className="size-4 animate-spin" /> {stage || 'Working…'}</> : <><Rocket className="size-4" /> Deploy Commit router</>}
        </button>
        {!checksPassed && <p className="text-xs" style={{ color: 'var(--subtle)' }}>Run the checks first. A failed check blocks deployment.</p>}
        {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
        {txHash && !deployed && <p className="mono text-xs break-all" style={{ color: 'var(--muted)' }}>Transaction: {txHash}</p>}
      </div>
      {deployed && (
        <div className="p-5 rounded-2xl flex flex-col gap-3" style={card}>
          <p className="text-sm font-bold" style={{ color: verifyFailed || verify.length === 0 ? 'var(--warning)' : 'var(--success)' }}>
            {verifyFailed ? 'Deployed, but NOT verified. Do not use this address.' : verify.length === 0 ? 'Deployed, verifying settings…' : 'Deployed and verified'}
          </p>
          <p className="mono text-xs break-all" style={{ color: 'var(--ink)' }}>{deployed}</p>
          <a href={buildAddressExplorerUrl(chain.id, deployed)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)', textDecoration: 'none' }}><ExternalLink className="size-3" /> View on the explorer</a>
          <div className="flex flex-col gap-2">{verify.map(c => (<div key={c.text} className="flex items-start gap-2 text-xs mono break-all" style={{ color: 'var(--ink-2)' }}>{icon(c.level)}<span>{c.text}</span></div>))}</div>
          {!verifyFailed && verify.length > 0 && !verify.some(c => c.level === 'fail') && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Next: in Vercel, set <span className="mono">VITE_COMMIT_ROUTER_ADDRESS</span> to this address (Production) and redeploy. The Commit tab then charges the fee. Test with a small amount first.</p>
          )}
        </div>
      )}
    </motion.div>
  )
}

async function findRouters(deployer: `0x${string}`): Promise<`0x${string}`[]> {
  const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
  const nonce = await client.getTransactionCount({ address: deployer })
  const found: `0x${string}`[] = []
  for (let i = Math.max(0, nonce - 25); i < nonce; i++) {
    const addr = getContractAddress({ from: deployer, nonce: BigInt(i) })
    const code = await client.getCode({ address: addr })
    if (!code || code === '0x') continue
    try {
      await client.readContract({ address: addr, abi: routerAbi, functionName: 'feeBps' })
      await client.readContract({ address: addr, abi: routerAbi, functionName: 'feeRecipient' })
      found.push(addr)
    } catch { /* not a router */ }
  }
  return found.reverse()
}

/** Dashboard card: the router the app uses, and routers deployed from this wallet. */
export function CommitRouterDashboardCard({ adminAddress }: { adminAddress: string }) {
  const { data: deployed } = useQuery({ queryKey: ['router-deployed', adminAddress, chain.id], queryFn: () => findRouters(adminAddress as `0x${string}`), retry: false })
  const active = (COMMIT_ROUTER_ADDRESS ?? '').toLowerCase()
  const others = (deployed ?? []).filter(a => a.toLowerCase() !== active)
  return (
    <div className="p-5 rounded-2xl flex flex-col gap-3" style={card}>
      <div className="flex items-center gap-2"><Rocket className="size-4" style={{ color: 'var(--accent)' }} /><span className="font-bold text-sm" style={{ color: 'var(--ink)' }}>Commit router</span></div>
      {COMMIT_ROUTER_ADDRESS && <RouterRow label="Active in the app" address={COMMIT_ROUTER_ADDRESS} />}
      {others.map((a, i) => <RouterRow key={a} label={i === 0 ? 'Deployed from your wallet (latest) — not active in the app yet' : 'Deployed from your wallet (earlier)'} address={a} />)}
      {!COMMIT_ROUTER_ADDRESS && others.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{deployed ? `No Commit router found from this wallet on ${chain.name}.` : 'Looking for your Commit router…'} Until one is active, Commit deposits go straight to the vault with no fee.</p>
      )}
      {!COMMIT_ROUTER_ADDRESS && others.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>To switch the fee on, set <span className="mono">VITE_COMMIT_ROUTER_ADDRESS</span> to the latest address in Vercel (Production) and redeploy.</p>
      )}
    </div>
  )
}

function RouterRow({ label, address }: { label: string; address: `0x${string}` }) {
  const { data } = useQuery({
    queryKey: ['router-row', address, chain.id],
    queryFn: async () => {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const [bps, recipient] = await Promise.all([
        client.readContract({ address, abi: routerAbi, functionName: 'feeBps' }),
        client.readContract({ address, abi: routerAbi, functionName: 'feeRecipient' }),
      ])
      return { bps, recipient }
    },
    retry: false,
  })
  return (
    <div className="rounded-xl px-3.5 py-3 flex flex-col gap-1.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>{label}</p>
      <p className="mono text-xs break-all" style={{ color: 'var(--ink)' }}>{address}</p>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>{data ? `Fee ${(Number(data.bps) / 100).toFixed(2)}% → ${data.recipient.slice(0, 8)}…${data.recipient.slice(-6)}` : 'Loading…'}</p>
      <div className="flex gap-3">
        <button onClick={() => { void navigator.clipboard.writeText(address); toast.success('Address copied') }} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--accent)' }}><Copy className="size-3" /> Copy</button>
        <a href={buildAddressExplorerUrl(chain.id, address)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--accent)', textDecoration: 'none' }}><ExternalLink className="size-3" /> Explorer</a>
      </div>
    </div>
  )
}

