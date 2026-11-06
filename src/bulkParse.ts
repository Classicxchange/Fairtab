/** Pure parsing for the bulk send list (no browser code, so it can be unit tested). */
import { isAddress, parseUnits } from 'viem'

export type Mode = 'lines' | 'same'
export interface Row {
  line: number
  recipient: string // as typed
  amount: bigint | null
  error?: string
  address?: `0x${string}`
  name?: string
}
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/

export function parseInput(text: string, mode: Mode, sameAmount: string): Row[] {
  const out: Row[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, idx) => {
    const t = raw.trim()
    if (!t) return
    const parts = t.split(/[\s,;\t]+/).filter(Boolean)
    if (idx === 0 && /address|wallet|recipient/i.test(parts[0]) && !/^0x[a-fA-F0-9]{40}$/.test(parts[0])) return
    const recipient = parts[0]
    let amount: bigint | null = null
    let error: string | undefined
    if (mode === 'same') {
      if (AMOUNT_RE.test(sameAmount) && Number(sameAmount) > 0) amount = parseUnits(sameAmount, 6)
      else error = 'Enter the amount for everyone'
      if (parts.length > 1) error = 'Only one wallet per line in this mode'
    } else if (parts.length < 2) {
      error = 'Add an amount after the wallet'
    } else if (!AMOUNT_RE.test(parts[1]) || Number(parts[1]) <= 0) {
      error = 'Amount must be a positive number (up to 6 decimals)'
    } else {
      amount = parseUnits(parts[1], 6)
    }
    const row: Row = { line: idx + 1, recipient, amount, error }
    if (isAddress(recipient)) row.address = recipient
    else if (/^0x/i.test(recipient)) row.error = row.error ?? 'Not a complete wallet address'
    else if (/^@?[a-z0-9_]{3,20}$/.test(recipient.toLowerCase())) row.name = recipient.replace(/^@/, '').toLowerCase()
    else row.error = row.error ?? 'Not a valid wallet address or @name'
    out.push(row)
  })
  return out
}

