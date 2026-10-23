/**
 * Fairtab API server — runs alongside Vite in dev (port 3001).
 * All Circle user-controlled wallet routes have been removed.
 * The server is kept for future extensibility and health checks.
 */

const PORT = 3001

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

// ── Server ────────────────────────────────────────────────────────────────────
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url    = new URL(req.url)
    const path   = url.pathname
    const origin = req.headers.get('Origin')
    const ch     = corsHeaders(origin)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch })

    if (path === '/api/health' && req.method === 'GET') {
      return Response.json({ ok: true }, { status: 200, headers: ch })
    }

    return new Response('Not found', { status: 404, headers: ch })
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
