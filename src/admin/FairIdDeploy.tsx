/**
 * FairID deploy section for /auth/admin.
 * You deploy from your own wallet. Nothing here is signed or sent for you.
 */
import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { createPublicClient, encodeDeployData, formatUnits, http, isAddress, parseAbi, parseUnits } from 'viem'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Rocket, ShieldCheck, XCircle } from 'lucide-react'
import { arcMainnetChain, arcTestnetChain, IS_MAINNET } from '@/config'
import { buildAddressExplorerUrl, getUsdc } from '@/onchain-facts'
import artifact from '../../contracts/out/FairID.sol/FairID.json'

const chain = IS_MAINNET ? arcMainnetChain : arcTestnetChain
const CANONICAL_USDC = getUsdc(chain.id)?.address ?? ''
const MAX_FEE_USDC = 100

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)' }
const input: React.CSSProperties = { background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--ink)' }

type Level = 'ok' | 'warn' | 'fail'
interface Check { level: Level; text: string }

const tokenAbi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function isBlacklisted(address) view returns (bool)',
])
const fairAbi = parseAbi([
  'function usdc() view returns (address)',
  'function feeRecipient() view returns (address)',
  'function claimFee() view returns (uint256)',
])

function parseFee(text: string): { raw: bigint; ok: boolean } {
  // Plain decimal numbers only, at most 6 decimal places. Nothing is rewritten or rounded.
  if (!/^\d+(\.\d{1,6})?$/.test(text.trim())) return { raw: 0n, ok: false }
  try {
    const raw = parseUnits(text.trim(), 6)
    return { raw, ok: raw > 0n && raw <= parseUnits(String(MAX_FEE_USDC), 6) }
  } catch {
    return { raw: 0n, ok: false }
  }
}

export function FairIdDeploySection({ adminAddress }: { adminAddress: string }) {
  const [usdc, setUsdc] = useState(CANONICAL_USDC)
  const [recipient, setRecipient] = useState('')
  const [feeText, setFeeText] = useState('1')
  const [checks, setChecks] = useState<Check[]>([])
  const [checkedKey, setCheckedKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [deployed, setDeployed] = useState('')
  const [verify, setVerify] = useState<Check[]>([])
  const [verifyFailed, setVerifyFailed] = useState(false)
  const [error, setError] = useState('')
  const deployedRef = useRef('')

  const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
  const bytecode = ((artifact.bytecode as unknown as { object?: string }).object ?? '') as `0x${string}`

  const { raw: feeRaw, ok: feeOk } = parseFee(feeText)

  const settingsKey = `${usdc.toLowerCase()}|${recipient.toLowerCase()}|${feeRaw.toString()}`

  const runChecks = async () => {
    const keyAtStart = settingsKey
    setChecking(true)
    setChecks([])
    setCheckedKey('')
    const out: Check[] = []
    try {
      if (!isAddress(usdc)) out.push({ level: 'fail', text: 'USDC address is not a valid address.' })
      if (!isAddress(recipient)) out.push({ level: 'fail', text: 'Fee recipient is not a valid address.' })
      if (!feeOk) out.push({ level: 'fail', text: `Fee must be above 0 and at most ${MAX_FEE_USDC} USDC.` })
      if (out.some(c => c.level === 'fail')) { setChecks([...out]); return }

      if (!CANONICAL_USDC) {
        out.push({ level: 'fail', text: `Fairtab has no verified USDC address for ${chain.name}, so this deployment is blocked.` })
      } else if (usdc.toLowerCase() !== CANONICAL_USDC.toLowerCase()) {
        out.push({ level: 'fail', text: `This is not the USDC address Fairtab expects on ${chain.name} (${CANONICAL_USDC}). A different token would be fixed forever, so deployment is blocked.` })
      } else {
        out.push({ level: 'ok', text: `USDC address matches the one Fairtab expects on ${chain.name}.` })
      }
      const code = await client.getCode({ address: usdc as `0x${string}` })
      if (!code || code === '0x') {
        out.push({ level: 'fail', text: 'No contract exists at the USDC address on this network. Every claim would fail.' })
      } else {
        try {
          const [sym, dec] = await Promise.all([
            client.readContract({ address: usdc as `0x${string}`, abi: tokenAbi, functionName: 'symbol' }),
            client.readContract({ address: usdc as `0x${string}`, abi: tokenAbi, functionName: 'decimals' }),
          ])
          out.push({ level: sym === 'USDC' && dec === 6 ? 'ok' : 'fail', text: `Token reports symbol ${sym} and ${dec} decimals${sym === 'USDC' && dec === 6 ? '.' : ' (expected USDC with 6).'}` })
        } catch {
          out.push({ level: 'fail', text: 'The token address did not answer symbol() and decimals().' })
        }
      }

      const rec = recipient.toLowerCase()
      if (rec === usdc.toLowerCase()) out.push({ level: 'fail', text: 'The fee recipient cannot be the USDC token itself.' })
      if (BigInt(recipient) < 0x10000n) out.push({ level: 'fail', text: 'The fee recipient looks like a system or precompile address. Use a normal wallet.' })
      if (rec === adminAddress.toLowerCase()) out.push({ level: 'warn', text: 'The fee recipient is the wallet you are deploying from. That is fine if you intend it.' })
      try {
        const bl = await client.readContract({ address: usdc as `0x${string}`, abi: tokenAbi, functionName: 'isBlacklisted', args: [recipient as `0x${string}`] })
        out.push({ level: bl ? 'fail' : 'ok', text: bl ? 'The fee recipient is blocklisted by the USDC issuer. Claims would fail forever.' : 'The fee recipient is not blocklisted right now.' })
      } catch {
        out.push({ level: 'warn', text: 'Could not check the USDC blocklist for the fee recipient. If it is ever blocklisted, every claim fails and cannot be fixed.' })
      }
      const rcode = await client.getCode({ address: recipient as `0x${string}` })
      out.push({ level: 'ok', text: rcode && rcode !== '0x' ? 'The fee recipient is a contract (for example a multisig).' : 'The fee recipient is a regular wallet.' })
    } catch (e) {
      out.push({ level: 'fail', text: `Checks failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` })
    } finally {
      setChecks([...out])
      setCheckedKey(keyAtStart)
      setChecking(false)
    }
  }

  const checksPassed = checks.length > 0 && !checks.some(c => c.level === 'fail') && checkedKey === settingsKey && !checking
  const canDeploy = checksPassed && confirmText === 'DEPLOY' && !deploying && !deployed

  const handleDeploy = async () => {
    setDeploying(true)
    setError('')
    try {
      const ethereum = (window as unknown as { ethereum?: { request: (a: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum
      if (!ethereum) throw new Error('No browser wallet found.')
      const chainHex = (await ethereum.request({ method: 'eth_chainId', params: [] })) as string
      if (parseInt(chainHex, 16) !== chain.id) throw new Error(`Switch your wallet to ${chain.name} (chain ${chain.id}) first.`)

      const data = encodeDeployData({
        abi: artifact.abi, bytecode,
        args: [usdc as `0x${string}`, recipient as `0x${string}`, feeRaw],
      })
      const hash = (await ethereum.request({ method: 'eth_sendTransaction', params: [{ from: adminAddress, data }] })) as string
      setTxHash(hash)
      const receipt = await client.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 180_000 })
      if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Deployment transaction failed.')
      const addr = receipt.contractAddress
      setDeployed(addr)
      deployedRef.current = addr
      setVerifyFailed(false)

      // Read the settings back from the chain so you can see what was really deployed
      const [u, r, f] = await Promise.all([
        client.readContract({ address: addr, abi: fairAbi, functionName: 'usdc' }),
        client.readContract({ address: addr, abi: fairAbi, functionName: 'feeRecipient' }),
        client.readContract({ address: addr, abi: fairAbi, functionName: 'claimFee' }),
      ])
      const results: Check[] = [
        { level: u.toLowerCase() === usdc.toLowerCase() ? 'ok' : 'fail', text: `usdc() = ${u}` },
        { level: r.toLowerCase() === recipient.toLowerCase() ? 'ok' : 'fail', text: `feeRecipient() = ${r}` },
        { level: f === feeRaw ? 'ok' : 'fail', text: `claimFee() = ${f.toString()} base units (${formatUnits(f, 6)} USDC)` },
      ]
      setVerify(results)
      if (results.some(c => c.level === 'fail')) {
        setVerifyFailed(true)
        toast.error('Deployed, but the settings read back do not match. Do not use this contract.')
      } else {
        toast.success('FairID deployed and verified')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.slice(0, 220))
      if (deployedRef.current) setVerifyFailed(true)
      toast.error(deployedRef.current ? 'Deployed, but could not verify the settings' : 'Deployment failed')
    } finally {
      setDeploying(false)
    }
  }

  const icon = (l: Level) => l === 'ok'
    ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
    : l === 'warn' ? <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
    : <XCircle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />

  return (
    <motion.div className="flex flex-col gap-5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Deploy FairID</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Name registry with a one-time claim fee, deployed to {chain.name} from your own wallet.
        </p>
      </div>

      {IS_MAINNET && (
        <div className="rounded-2xl p-4 text-xs leading-relaxed" style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning)', color: 'var(--ink-2)' }}>
          <strong>Mainnet uses real funds and cannot be undone.</strong> The fee, the fee recipient and the USDC address are fixed forever once deployed. Arc Studio does not deploy for you. Review every value yourself, and have the contract independently audited before you rely on it.
        </div>
      )}

      <div className="p-5 rounded-2xl flex flex-col gap-4" style={card}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>USDC token address</label>
          <input value={usdc} onChange={e => { setUsdc(e.target.value.trim()); setChecks([]) }} disabled={checking || deploying || !!deployed} className="mono rounded-xl px-4 py-2.5 text-sm outline-none" style={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Fee recipient (you choose, no default)</label>
          <input value={recipient} onChange={e => { setRecipient(e.target.value.trim()); setChecks([]) }} placeholder="0x… wallet that receives every fee" disabled={checking || deploying || !!deployed} className="mono rounded-xl px-4 py-2.5 text-sm outline-none" style={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Claim fee (USDC)</label>
          <input value={feeText} onChange={e => { setFeeText(e.target.value); setChecks([]) }} inputMode="decimal" disabled={checking || deploying || !!deployed} className="rounded-xl px-4 py-2.5 text-sm outline-none" style={input} />
        </div>
        <div className="rounded-xl px-4 py-3 text-xs mono break-all" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
          constructor(usdc_ = {usdc || '…'}, feeRecipient_ = {recipient || '…'}, claimFee_ = {feeOk ? `${feeRaw.toString()} base units (${formatUnits(feeRaw, 6)} USDC)` : 'invalid'})
        </div>
        <button onClick={() => { void runChecks() }} disabled={checking}
          className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
          {checking ? <><Loader2 className="size-4 animate-spin" /> Checking…</> : <><ShieldCheck className="size-4" /> Check these settings</>}
        </button>
        {checks.length > 0 && (
          <div className="flex flex-col gap-2">
            {checks.map(c => (
              <div key={c.text} className="flex items-start gap-2 text-xs" style={{ color: 'var(--ink-2)' }}>{icon(c.level)}<span>{c.text}</span></div>
            ))}
          </div>
        )}
      </div>

      <div className="p-5 rounded-2xl flex flex-col gap-3" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Deploy</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Type <span className="mono font-bold">DEPLOY</span> to confirm. Your wallet will then ask you to sign the deployment from {adminAddress.slice(0, 8)}…{adminAddress.slice(-6)}.
        </p>
        <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="DEPLOY" disabled={checking || deploying || !!deployed} className="mono rounded-xl px-4 py-2.5 text-sm outline-none" style={input} />
        <button onClick={() => { void handleDeploy() }} disabled={!canDeploy}
          className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
          {deploying ? <><Loader2 className="size-4 animate-spin" /> Waiting for confirmation…</> : <><Rocket className="size-4" /> Deploy FairID</>}
        </button>
        {!feeOk && feeText && <p className="text-xs" style={{ color: 'var(--danger)' }}>Enter a plain number such as 1 or 2.5 (up to 6 decimals, no commas).</p>}
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
          <a href={buildAddressExplorerUrl(chain.id, deployed)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            <ExternalLink className="size-3" /> View on the explorer
          </a>
          <div className="flex flex-col gap-2">
            {verify.map(c => (<div key={c.text} className="flex items-start gap-2 text-xs mono break-all" style={{ color: 'var(--ink-2)' }}>{icon(c.level)}<span>{c.text}</span></div>))}
          </div>
          {!verifyFailed && verify.length > 0 && !verify.some(c => c.level === 'fail') && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Next: in Vercel, set <span className="mono">VITE_FAIRID_MAINNET_ADDRESS</span> to this address (Production) and redeploy. Check the three values above match what you intended before you do.
          </p>
          )}
        </div>
      )}
    </motion.div>
  )
}
