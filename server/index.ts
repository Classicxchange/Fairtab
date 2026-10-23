/**
 * Fairtab API server — runs alongside Vite in dev (port 3001).
 * Handles Circle user-controlled wallet operations server-side
 * so the API key never reaches the browser.
 */

import {
  initiateUserControlledWalletsClient,
  Blockchain,
} from '@circle-fin/user-controlled-wallets'

const PORT = 3001

const circleClient = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
})

// ── Allowed origins ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:4173',
  ...(process.env.VITE_APP_URL ? [process.env.VITE_APP_URL] : []),
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

// ── Rate limiting (per IP, in-memory) ─────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
function isRateLimited(ip: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count++
  return entry.count > limit
}

// ── Server ────────────────────────────────────────────────────────────────────
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url    = new URL(req.url)
    const path   = url.pathname
    const origin = req.headers.get('Origin')
    const ip     = req.headers.get('x-forwarded-for') ?? 'unknown'
    const ch     = corsHeaders(origin)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch })

    if (isRateLimited(ip)) {
      return Response.json({ error: 'Too many requests' }, { status: 429, headers: ch })
    }

    // ── Health ───────────────────────────────────────────────────────────────
    if (path === '/api/health' && req.method === 'GET') {
      return Response.json({ ok: true }, { status: 200, headers: ch })
    }

    // ── Device token (used by Google + email OTP flows) ──────────────────────
    if (path === '/api/wallet/device-token' && req.method === 'POST') {
      try {
        const body = await req.json() as { deviceId: string }
        const res = await circleClient.createUserTokenWithDeviceId({ deviceId: body.deviceId })
        return Response.json(res.data, { status: 200, headers: ch })
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500, headers: ch })
      }
    }

    // ── Request OTP (email) ──────────────────────────────────────────────────
    if (path === '/api/wallet/request-otp' && req.method === 'POST') {
      try {
        const body = await req.json() as { deviceId: string; email: string }
        const res = await circleClient.createOtpToken({
          deviceId: body.deviceId,
          email: body.email,
        })
        return Response.json(res.data, { status: 200, headers: ch })
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500, headers: ch })
      }
    }

    // ── Initialize wallet (first-time setup after OAuth/OTP) ─────────────────
    if (path === '/api/wallet/initialize' && req.method === 'POST') {
      try {
        const body = await req.json() as { userToken: string }
        // Try to create user + wallet; handle already-exists gracefully
        try {
          const initRes = await circleClient.createUserPinWithWallets({
            userToken: body.userToken,
            blockchains: [Blockchain.ARC],
          })
          return Response.json({ challengeId: initRes.data?.challengeId }, { status: 200, headers: ch })
        } catch (inner) {
          const code = (inner as { code?: number }).code
          if (code === 155106 || code === 155101) {
            return Response.json({ alreadyInitialized: true }, { status: 200, headers: ch })
          }
          throw inner
        }
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500, headers: ch })
      }
    }

    // ── List wallets ─────────────────────────────────────────────────────────
    if (path === '/api/wallet/list' && req.method === 'GET') {
      try {
        const userToken = url.searchParams.get('userToken') ?? ''
        const res = await circleClient.listWallets({ userToken, blockchain: Blockchain.ARC })
        const wallets = res.data?.wallets?.map(w => ({ id: w.id, address: w.address })) ?? []
        return Response.json({ wallets }, { status: 200, headers: ch })
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500, headers: ch })
      }
    }

    return new Response('Not found', { status: 404, headers: ch })
  },
})

// ── Production startup guard ───────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const required = ['VITE_APP_URL', 'CIRCLE_API_KEY'] as const
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`FATAL: Missing required env vars for production: ${missing.join(', ')}`)
    process.exit(1)
  }
}

console.log(`Fairtab API server running on http://localhost:${PORT}${process.env.NODE_ENV === 'production' ? ' [production]' : ''}`)
