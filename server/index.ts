/**
 * Fairtab API server — runs alongside Vite in dev (port 3001).
 * Routes:
 *   POST /api/wallet/device-token  — social login device token
 *   POST /api/wallet/request-otp   — email OTP request
 *   POST /api/wallet/initialize    — initialize user + create wallet challenge
 *   GET  /api/wallet/list          — list wallets for a userToken
 */
import {
  initiateUserControlledWalletsClient,
  Blockchain,
} from '@circle-fin/user-controlled-wallets'

const PORT = 3001

// ── Allowed origins ────────────────────────────────────────────────────────────
// Add your production domain to this list before mainnet deploy.
// The VITE_APP_URL env var is the canonical way to pass it in CI/CD.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:4173',
  ...(process.env.VITE_APP_URL ? [process.env.VITE_APP_URL] : []),
  // fallback hardcoded prod domain — replace with your real domain:
  // 'https://fairtab.xyz',
])
function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

// ── Rate limiting (per-IP, in-memory) ─────────────────────────────────────────
const _rateLimits = new Map<string, { count: number; reset: number }>()
function rateLimit(ip: string, limit = 10, windowMs = 60_000): boolean {
  const now = Date.now()
  const entry = _rateLimits.get(ip) ?? { count: 0, reset: now + windowMs }
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs }
  entry.count++
  _rateLimits.set(ip, entry)
  return entry.count <= limit
}

// ── User-controlled wallets client ────────────────────────────────────────────
function getWalletClient() {
  const apiKey = process.env.CIRCLE_API_KEY
  if (!apiKey) return null
  return initiateUserControlledWalletsClient({ apiKey })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const MAX_BODY = 64 * 1024 // 64 KB
const readJson = async (req: Request): Promise<Record<string, string>> => {
  const text = await req.text()
  if (text.length > MAX_BODY) throw new Error('Request body too large')
  return JSON.parse(text) as Record<string, string>
}
const json = (data: unknown, status = 200, origin: string | null = null) =>
  Response.json(data, { status, headers: corsHeaders(origin) })

// ── Simple string validation helpers ──────────────────────────────────────────
function isValidEmail(s: string): boolean {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}
function isValidId(s: string): boolean {
  return typeof s === 'string' && s.length > 0 && s.length <= 256
}
function isValidUserToken(s: string): boolean {
  return typeof s === 'string' && s.length > 0 && s.length <= 1024
}

// ── Server ────────────────────────────────────────────────────────────────────
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url    = new URL(req.url)
    const path   = url.pathname
    const origin = req.headers.get('Origin')
    const ip     = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
    const ch     = corsHeaders(origin)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch })

    try {
      // ── Social login: create device token ───────────────────────────────────
      if (path === '/api/wallet/device-token' && req.method === 'POST') {
        if (!rateLimit(ip, 10)) return json({ error: 'Too many requests' }, 429, origin)
        const client = getWalletClient()
        if (!client) return json({ error: 'Wallet service not configured' }, 500, origin)
        const body = await readJson(req)
        if (!isValidId(body.deviceId)) return json({ error: 'Invalid deviceId' }, 400, origin)
        const res = await client.createDeviceTokenForSocialLogin({ deviceId: body.deviceId })
        return json(res.data, 200, origin)
      }

      // ── Email OTP: request one-time code ────────────────────────────────────
      if (path === '/api/wallet/request-otp' && req.method === 'POST') {
        if (!rateLimit(ip, 5, 60_000)) return json({ error: 'Too many requests' }, 429, origin)
        const client = getWalletClient()
        if (!client) return json({ error: 'Wallet service not configured' }, 500, origin)
        const body = await readJson(req)
        if (!isValidId(body.deviceId)) return json({ error: 'Invalid deviceId' }, 400, origin)
        if (!isValidEmail(body.email))  return json({ error: 'Invalid email' }, 400, origin)
        const res = await client.createDeviceTokenForEmailLogin({ deviceId: body.deviceId, email: body.email })
        return json(res.data, 200, origin)
      }

      // ── Initialize user / create wallet challenge ────────────────────────────
      if (path === '/api/wallet/initialize' && req.method === 'POST') {
        if (!rateLimit(ip, 10)) return json({ error: 'Too many requests' }, 429, origin)
        const client = getWalletClient()
        if (!client) return json({ error: 'Wallet service not configured' }, 500, origin)
        const body = await readJson(req)
        if (!isValidUserToken(body.userToken)) return json({ error: 'Invalid userToken' }, 400, origin)
        try {
          const res = await client.createUserPinWithWallets({
            userToken: body.userToken,
            blockchains: [Blockchain.ArcTestnet],
            accountType: 'SCA',
          })
          return json(res.data, 200, origin)
        } catch (err: unknown) {
          const code = (err as { response?: { data?: { code?: number } } })?.response?.data?.code
          if (code === 155106) return json({ code: 155106, alreadyInitialized: true }, 200, origin)
          console.error('[wallet/initialize]', err)
          return json({ error: 'Internal server error' }, 500, origin)
        }
      }

      // ── List wallets ────────────────────────────────────────────────────────
      if (path === '/api/wallet/list' && req.method === 'GET') {
        if (!rateLimit(ip, 20)) return json({ error: 'Too many requests' }, 429, origin)
        const client = getWalletClient()
        if (!client) return json({ error: 'Wallet service not configured' }, 500, origin)
        const userToken = url.searchParams.get('userToken') ?? ''
        if (!isValidUserToken(userToken)) return json({ error: 'Invalid userToken' }, 400, origin)
        const res = await client.listWallets({ userToken })
        return json(res.data, 200, origin)
      }

      return new Response('Not found', { status: 404, headers: ch })

    } catch (err) {
      console.error('[unhandled]', err)
      return json({ error: 'Internal server error' }, 500, origin)
    }
  },
})

// ── Production startup guard ───────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const required = ['VITE_APP_URL'] as const
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`FATAL: Missing required env vars for production: ${missing.join(', ')}`)
    process.exit(1)
  }
}

console.log(`Fairtab API server running on http://localhost:${PORT}${process.env.NODE_ENV === 'production' ? ' [production]' : ''}`)
