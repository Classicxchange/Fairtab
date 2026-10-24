/**
 * Fairtab Admin Panel — /auth/admin
 * Only accessible to whitelisted admin addresses via MetaMask.
 * Not linked from the public frontend.
 */
import { useState, useCallback, useMemo } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, LayoutDashboard, FileText, Rocket, Settings,
  Loader2, CheckCircle2, XCircle,
  ExternalLink, Copy, ChevronDown, ChevronUp,
  RefreshCw, Trash2, DollarSign, Activity,
  Terminal, Package,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createPublicClient, http, encodeDeployData,
} from 'viem'
import { arcMainnetChain, arcTestnetChain, IS_MAINNET } from '@/config'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import artifact from '../../contracts/out/HouseholdBillSplitter.sol/HouseholdBillSplitter.json'

// ─── Admin whitelist ──────────────────────────────────────────────────────────
const ADMIN_ADDRESSES = [
  '0xF30173E31Cb9B6A7234F4318b4A0183324BcA743',
  '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
].map(a => a.toLowerCase())

// ─── Contract config ──────────────────────────────────────────────────────────
const CHAIN_ID = IS_MAINNET ? arcMainnetChain.id : arcTestnetChain.id
const arcChain = IS_MAINNET ? arcMainnetChain : arcTestnetChain
const TESTNET_CONTRACT = '0xdb58ca32df331cf4729ee8668d19cc254f2d9326' as const
const MAINNET_CONTRACT = '0x2d4c3580B6B3BD5f1aEa2f0CF04649ED558769C0' as const
const CONTRACT_ADDRESS = (IS_MAINNET ? MAINNET_CONTRACT : TESTNET_CONTRACT) as `0x${string}`
const CONTRACT_ABI = artifact.abi
const USDC_ADDRESS = IS_MAINNET
  ? '0x3600000000000000000000000000000000000000' as const
  : '0x3800000000000000000000000000000000000000' as const

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: bigint) => formatUsdc(v)
const fmtAddr = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`
const STATUS_LABEL: Record<number, string> = { 0: 'Active', 1: 'Settled', 2: 'Cancelled' }
const STATUS_COLOR: Record<number, string> = {
  0: 'var(--accent)',
  1: 'var(--success)',
  2: 'var(--danger)',
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  boxShadow: 'var(--shadow)',
}
const inner: React.CSSProperties = {
  background: 'var(--surface-muted)',
  border: '1px solid var(--border)',
  borderRadius: 10,
}
const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18 },
}

type AdminSection = 'dashboard' | 'bills' | 'deploy' | 'manage'

// ─── Section: Dashboard ───────────────────────────────────────────────────────
function DashboardSection() {
  const { data: billCount, refetch } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'billCount', chainId: CHAIN_ID,
  })
  const count = billCount != null ? Number(billCount) : 0

  // Read all bills to compute stats
  const [stats, setStats] = useState({ active: 0, settled: 0, cancelled: 0, totalUSDC: 0n, paidUSDC: 0n })
  const [scanning, setScanning] = useState(false)

  const scanBills = useCallback(async () => {
    setScanning(true)
    const client = createPublicClient({ chain: arcChain, transport: http(arcChain.rpcUrls.default.http[0]) })
    let active = 0, settled = 0, cancelled = 0, totalUSDC = 0n, paidUSDC = 0n
    const ids = Array.from({ length: count }, (_, i) => BigInt(i))
    const results = await Promise.allSettled(
      ids.map(id => client.readContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBill', args: [id] }))
    )
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      const d = r.value as unknown[]
      const status = Number(d[4])
      const total = d[2] as bigint
      const paid = d[3] as bigint
      if (status === 0) active++
      else if (status === 1) settled++
      else cancelled++
      totalUSDC += total
      paidUSDC += paid
    }
    setStats({ active, settled, cancelled, totalUSDC, paidUSDC })
    setScanning(false)
    toast.success('Stats updated')
  }, [count])

  const statCards = [
    { label: 'Total Bills', value: count, icon: FileText, color: 'var(--accent)' },
    { label: 'Active', value: stats.active, icon: Activity, color: 'var(--accent)' },
    { label: 'Settled', value: stats.settled, icon: CheckCircle2, color: 'var(--success)' },
    { label: 'Cancelled', value: stats.cancelled, icon: XCircle, color: 'var(--danger)' },
    { label: 'Total USDC', value: fmt(stats.totalUSDC), icon: DollarSign, color: 'var(--accent)' },
    { label: 'Paid In', value: fmt(stats.paidUSDC), icon: DollarSign, color: 'var(--success)' },
  ]

  return (
    <motion.div className="flex flex-col gap-6" {...fadeUp}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Dashboard</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'} · Contract {fmtAddr(CONTRACT_ADDRESS)}
          </p>
        </div>
        <button onClick={() => { void refetch(); void scanBills() }}
          disabled={scanning}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          {scanning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {scanning ? 'Scanning…' : 'Refresh stats'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="p-4 flex flex-col gap-2" style={card}>
            <div className="flex items-center gap-2">
              <Icon className="size-4" style={{ color }} />
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>{label}</span>
            </div>
            <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              {value.toString()}
            </span>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-2xl flex items-center gap-3" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
        <Terminal className="size-5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Contract address</p>
          <p className="mono text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{CONTRACT_ADDRESS}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { void navigator.clipboard.writeText(CONTRACT_ADDRESS); toast.success('Copied') }}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
            <Copy className="size-3.5 inline mr-1" />Copy
          </button>
          <a href={buildAddressExplorerUrl(CHAIN_ID, CONTRACT_ADDRESS)} target="_blank" rel="noreferrer"
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', textDecoration: 'none' }}>
            <ExternalLink className="size-3.5 inline mr-1" />Explorer
          </a>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Section: Bills manager ───────────────────────────────────────────────────
function AdminBillRow({ id, refetch: _refetch }: { id: bigint; refetch: () => void }) {
  const { data: billData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBill', args: [id], chainId: CHAIN_ID })
  const { data: sharesData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getShares', args: [id], chainId: CHAIN_ID })
  const { data: metaData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBillMeta', args: [id], chainId: CHAIN_ID })
  const [expanded, setExpanded] = useState(false)

  if (!billData) return (
    <div className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--surface-muted)' }} />
  )
  const [creator, payee, totalAmount, amountPaid, status, deadline] = billData as [string, string, bigint, bigint, number, bigint, ...unknown[]]
  const shares = (sharesData ?? []) as Array<{ participant: string; amount: bigint; contributed: bigint }>
  const [labelHex] = (metaData ?? ['0x' + '0'.repeat(64)]) as [`0x${string}`, ...unknown[]]
  const label = (() => { try { const b = labelHex.replace('0x','').match(/.{2}/g)?.map(c=>parseInt(c,16))??[]; return new TextDecoder().decode(new Uint8Array(b)).replace(/\0+$/,'').trim() } catch { return '' } })()
  const pct = totalAmount > 0n ? Number((amountPaid * 100n) / totalAmount) : 0

  return (
    <div className="rounded-xl overflow-hidden" style={inner}>
      <button onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/5 transition-colors">
        <span className="mono text-xs font-bold tabular-nums w-6 shrink-0" style={{ color: 'var(--muted)' }}>#{id.toString()}</span>
        <span className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--ink)' }}>{label || '—'}</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
          style={{ background: STATUS_COLOR[Number(status)] + '20', color: STATUS_COLOR[Number(status)] }}>
          {STATUS_LABEL[Number(status)]}
        </span>
        <span className="mono text-xs tabular-nums shrink-0" style={{ color: 'var(--muted)' }}>{fmt(amountPaid)}/{fmt(totalAmount)} USDC</span>
        <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--accent)' }}>{pct}%</span>
        {expanded ? <ChevronUp className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} /> : <ChevronDown className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="px-4 pb-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['Creator', fmtAddr(creator)],
                  ['Payee', fmtAddr(payee)],
                  ['Deadline', deadline > 0n ? new Date(Number(deadline) * 1000).toLocaleString() : 'None'],
                  ['Participants', shares.length.toString()],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <span style={{ color: 'var(--muted)' }}>{k}</span>
                    <span className="font-semibold mono" style={{ color: 'var(--ink-2)' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {shares.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg" style={{ background: 'var(--surface-strong)' }}>
                    <span className="mono" style={{ color: 'var(--ink-2)' }}>{fmtAddr(s.participant)}</span>
                    <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{fmt(s.contributed)}/{fmt(s.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <a href={`${arcChain.blockExplorers?.default.url}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-xs font-semibold rounded-lg px-3 py-1.5"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', textDecoration: 'none' }}>
                  <ExternalLink className="size-3" /> Explorer
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BillsSection() {
  const { data: billCount, refetch } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'billCount', chainId: CHAIN_ID })
  const count = billCount != null ? Number(billCount) : 0
  const ids = useMemo(() => Array.from({ length: count }, (_, i) => BigInt(count - 1 - i)), [count])
  const [search, setSearch] = useState('')

  return (
    <motion.div className="flex flex-col gap-5" {...fadeUp}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>All Bills</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{count} total on-chain</p>
        </div>
        <button onClick={() => void refetch()} className="rounded-xl px-3 py-2 text-xs font-semibold flex items-center gap-1.5"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
          <RefreshCw className="size-3.5" /> Refresh
        </button>
      </div>
      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Filter by bill ID…"
        className="rounded-xl px-4 py-2.5 text-sm outline-none"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
      />
      <div className="flex flex-col gap-2">
        {ids
          .filter(id => !search || id.toString().includes(search))
          .map(id => <AdminBillRow key={id.toString()} id={id} refetch={() => void refetch()} />)
        }
        {count === 0 && (
          <p className="text-center py-12 text-sm" style={{ color: 'var(--muted)' }}>No bills on-chain yet.</p>
        )}
      </div>
    </motion.div>
  )
}

// ─── Section: Deploy contract ─────────────────────────────────────────────────
function DeploySection({ adminAddress }: { adminAddress: string }) {
  const [usdcOverride, setUsdcOverride] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null)
  const [deployTxHash, setDeployTxHash] = useState<string | null>(null)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  const addLog = (msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const usdcAddress = usdcOverride || USDC_ADDRESS

  const handleDeploy = useCallback(async () => {
    setDeploying(true)
    setDeployedAddress(null)
    setDeployTxHash(null)
    setDeployError(null)
    setLog([])
    try {
      addLog(`Deploying HouseholdBillSplitter on ${IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}…`)
      addLog(`Constructor arg: usdc_ = ${usdcAddress}`)
      addLog('Requesting MetaMask signature…')

      // Use wagmi/window.ethereum to send the deploy tx
      const ethereum = (window as unknown as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum
      if (!ethereum) throw new Error('MetaMask not found')

      const bytecode = (artifact.bytecode.object ?? artifact.bytecode) as `0x${string}`
      const deployData = encodeDeployData({
        abi: CONTRACT_ABI,
        bytecode,
        args: [usdcAddress],
      })

      addLog('Sending deployment transaction…')
      const txHash = await ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: adminAddress,
          data: deployData,
          chainId: `0x${CHAIN_ID.toString(16)}`,
        }],
      }) as string

      setDeployTxHash(txHash)
      addLog(`Transaction sent: ${txHash}`)
      addLog('Waiting for confirmation…')

      const client = createPublicClient({ chain: arcChain, transport: http(arcChain.rpcUrls.default.http[0]) })
      const receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 120_000 })

      const addr = receipt.contractAddress
      if (!addr) throw new Error('No contract address in receipt')

      setDeployedAddress(addr)
      addLog(`Contract deployed at: ${addr}`)
      addLog('Update MAINNET_CONTRACT / TESTNET_CONTRACT in App.tsx and CreateBillPage.tsx with this address.')
      toast.success(`Contract deployed: ${addr}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDeployError(msg)
      addLog(`ERROR: ${msg}`)
      toast.error('Deployment failed')
    } finally {
      setDeploying(false)
    }
  }, [adminAddress, usdcAddress])

  return (
    <motion.div className="flex flex-col gap-6" {...fadeUp}>
      <div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Deploy Contract</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Deploy a new HouseholdBillSplitter to {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'} directly from MetaMask.
        </p>
      </div>

      <div className="p-5 rounded-2xl flex flex-col gap-4" style={card}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>USDC Contract Address</label>
          <input
            value={usdcOverride}
            onChange={e => setUsdcOverride(e.target.value)}
            placeholder={`Default: ${USDC_ADDRESS}`}
            className="rounded-xl px-4 py-2.5 text-sm mono outline-none"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          />
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>Leave blank to use the canonical USDC address for this network.</p>
        </div>

        <div className="rounded-xl px-4 py-3 flex flex-col gap-1" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Deployer</p>
          <p className="mono text-xs" style={{ color: 'var(--muted)' }}>{adminAddress}</p>
          <p className="text-xs font-semibold mt-1" style={{ color: 'var(--ink-2)' }}>Network</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'} (chain {CHAIN_ID})</p>
        </div>

        <button onClick={() => void handleDeploy()} disabled={deploying}
          className="flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold disabled:opacity-50 transition-all"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          {deploying ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
          {deploying ? 'Deploying…' : 'Deploy contract'}
        </button>
      </div>

      {/* Deployed address result */}
      {deployedAddress && (
        <motion.div className="p-5 rounded-2xl flex flex-col gap-3" {...fadeUp}
          style={{ background: 'var(--success-bg)', border: '1px solid var(--success)' }}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5" style={{ color: 'var(--success)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--success)' }}>Deployed successfully</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>New contract address:</p>
          <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={inner}>
            <span className="mono text-sm font-bold flex-1 break-all" style={{ color: 'var(--ink)' }}>{deployedAddress}</span>
            <button onClick={() => { void navigator.clipboard.writeText(deployedAddress); toast.success('Copied') }}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold shrink-0"
              style={{ background: 'var(--surface-strong)', color: 'var(--ink-2)' }}>
              <Copy className="size-3.5 inline mr-1" />Copy
            </button>
          </div>
          {deployTxHash && (
            <a href={buildTxExplorerUrl(CHAIN_ID, deployTxHash)} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              <ExternalLink className="size-3" /> View transaction on ArcScan
            </a>
          )}
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.2)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Next step:</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Update <span className="mono font-semibold">MAINNET_CONTRACT</span> (or <span className="mono font-semibold">TESTNET_CONTRACT</span>) in{' '}
              <span className="mono">src/App.tsx</span> and <span className="mono">src/CreateBillPage.tsx</span> with the address above, then redeploy.
            </p>
          </div>
        </motion.div>
      )}

      {deployError && (
        <div className="p-4 rounded-xl" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>Deployment failed</p>
          <p className="text-xs mt-1 mono" style={{ color: 'var(--danger)' }}>{deployError}</p>
        </div>
      )}

      {/* Terminal log */}
      {log.length > 0 && (
        <div className="rounded-xl p-4 overflow-auto max-h-64" style={{ background: '#0a0f1c', border: '1px solid rgba(255,255,255,0.08)' }}>
          {log.map((line, i) => (
            <p key={i} className="mono text-xs leading-relaxed" style={{ color: i === log.length - 1 ? '#7dd3fc' : '#94a3b8' }}>{line}</p>
          ))}
        </div>
      )}
    </motion.div>
  )
}

// ─── Section: Contract management ────────────────────────────────────────────
function ManageSection() {
  const [recoverToken, setRecoverToken] = useState('')
  const [recoverTo, setRecoverTo] = useState('')

  const { writeContract: writeRecover, data: recoverHash, isPending: recoverPending } = useWriteContract()
  const { isLoading: recoverConfirming, isSuccess: recoverSuccess } = useWaitForTransactionReceipt({ hash: recoverHash })

  const handleRecoverToken = useCallback(() => {
    if (!recoverToken.startsWith('0x') || !recoverTo.startsWith('0x')) {
      toast.error('Enter valid addresses')
      return
    }
    writeRecover({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'recoverToken',
      args: [recoverToken as `0x${string}`, recoverTo as `0x${string}`],
    })
  }, [recoverToken, recoverTo, writeRecover])

  if (recoverSuccess) toast.success('Token recovered')

  return (
    <motion.div className="flex flex-col gap-6" {...fadeUp}>
      <div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Contract Management</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Owner-only functions on the deployed contract.</p>
      </div>

      {/* recoverToken */}
      <div className="p-5 rounded-2xl flex flex-col gap-4" style={card}>
        <div className="flex items-center gap-2">
          <Trash2 className="size-4" style={{ color: 'var(--danger)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Recover stranded tokens</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Sweep tokens accidentally sent to the contract. Only sweeps the surplus above what active bill accounting tracks.
        </p>
        <div className="flex flex-col gap-2">
          <input value={recoverToken} onChange={e => setRecoverToken(e.target.value)}
            placeholder="Token contract address (e.g. USDC 0x3600…)"
            className="rounded-xl px-4 py-2.5 text-sm mono outline-none"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
          <input value={recoverTo} onChange={e => setRecoverTo(e.target.value)}
            placeholder="Recipient address"
            className="rounded-xl px-4 py-2.5 text-sm mono outline-none"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
        </div>
        <button onClick={handleRecoverToken}
          disabled={recoverPending || recoverConfirming || !recoverToken || !recoverTo}
          className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
          style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid rgba(220,38,38,0.25)' }}>
          {recoverPending || recoverConfirming
            ? <><Loader2 className="size-4 animate-spin" /> Processing…</>
            : recoverSuccess ? <><CheckCircle2 className="size-4" /> Recovered</>
            : <><Trash2 className="size-4" /> Recover tokens</>}
        </button>
        {recoverHash && (
          <a href={buildTxExplorerUrl(CHAIN_ID, recoverHash)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            <ExternalLink className="size-3" /> View transaction
          </a>
        )}
      </div>

      {/* Contract info */}
      <div className="p-5 rounded-2xl flex flex-col gap-3" style={card}>
        <div className="flex items-center gap-2">
          <Package className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Contract constants</span>
        </div>
        {[
          ['MAX_PARTICIPANTS', '20'],
          ['INVITE_EXPIRY', '24 hours'],
          ['MAX_BILL_DURATION', '90 days'],
          ['PAYOUT_REDIRECT_GRACE', '7 days'],
          ['PAYOUT_RECLAIM_TIMEOUT', '91 days'],
          ['MIN_CANCEL_THRESHOLD', '51% of eligible voters'],
          ['MIN_REDIRECT_QUORUM', '51% of contributors'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-3 py-2 rounded-lg" style={inner}>
            <span className="mono text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{k}</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{v}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ─── Auth gate ────────────────────────────────────────────────────────────────
function NotAdmin() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-6 px-4"
      style={{ background: 'var(--bg)' }}>
      <div className="flex size-16 items-center justify-center rounded-2xl"
        style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)' }}>
        <Shield className="size-8" style={{ color: 'var(--danger)' }} />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Access denied</h1>
        <p className="text-sm mt-2 max-w-xs" style={{ color: 'var(--muted)' }}>
          This page is restricted to authorised admin wallets. Connect with a whitelisted address via MetaMask.
        </p>
      </div>
      <ConnectKitButton />
      <a href="/" className="text-xs" style={{ color: 'var(--muted)', textDecoration: 'none' }}>← Back to Fairtab</a>
    </div>
  )
}

// ─── Main AdminApp ────────────────────────────────────────────────────────────
export default function AdminApp() {
  const { address } = useAccount()
  const isAdmin = !!address && ADMIN_ADDRESSES.includes(address.toLowerCase())
  const [section, setSection] = useState<AdminSection>('dashboard')

  if (!isAdmin) return <NotAdmin />

  const navItems: Array<{ id: AdminSection; label: string; icon: React.ElementType }> = [
    { id: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard },
    { id: 'bills',     label: 'All Bills',  icon: FileText         },
    { id: 'deploy',    label: 'Deploy',     icon: Rocket           },
    { id: 'manage',    label: 'Manage',     icon: Settings         },
  ]

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-3"
        style={{ background: 'var(--surface-strong)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent)' }}>
            <Shield className="size-4" style={{ color: '#fff' }} />
          </div>
          <div>
            <span className="font-bold text-sm" style={{ color: 'var(--ink)' }}>Fairtab Admin</span>
            <p className="text-[10px] leading-none mt-0.5" style={{ color: 'var(--muted)' }}>
              {IS_MAINNET ? 'Mainnet' : 'Testnet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono text-xs px-3 py-1.5 rounded-full"
            style={{ background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-bg)' }}>
            Admin · {address ? fmtAddr(address) : '—'}
          </span>
          <a href="/" className="text-xs font-semibold rounded-xl px-3 py-1.5"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', textDecoration: 'none', border: '1px solid var(--border)' }}>
            ← App
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 flex gap-6 items-start">
        {/* Sidebar nav */}
        <aside className="hidden md:flex flex-col gap-1 w-44 shrink-0 sticky top-24">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setSection(id)}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all text-left"
              style={{
                background: section === id ? 'var(--accent-light)' : 'transparent',
                color: section === id ? 'var(--accent)' : 'var(--ink-2)',
                border: `1px solid ${section === id ? 'var(--accent-border)' : 'transparent'}`,
              }}>
              <Icon className="size-4 shrink-0" /> {label}
            </button>
          ))}
        </aside>

        {/* Mobile tab bar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-20 flex p-2 gap-1"
          style={{ background: 'var(--surface-strong)', borderTop: '1px solid var(--border)' }}>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setSection(id)}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-[10px] font-semibold"
              style={{ background: section === id ? 'var(--accent)' : 'transparent', color: section === id ? '#fff' : 'var(--subtle)' }}>
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0 pb-24 md:pb-0">
          <AnimatePresence mode="wait">
            {section === 'dashboard' && <DashboardSection key="dashboard" />}
            {section === 'bills'     && <BillsSection     key="bills" />}
            {section === 'deploy'    && <DeploySection    key="deploy" adminAddress={address} />}
            {section === 'manage'    && <ManageSection    key="manage" />}
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
