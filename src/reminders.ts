/**
 * Works out the in-app reminders for a wallet from its bills.
 * Pure logic: no network calls. The data comes from the bill lookups the app already makes.
 */

export interface BillSnapshot {
  id: bigint
  creator: string
  payee: string
  totalAmount: bigint
  amountPaid: bigint
  status: number // 0 active, 1 settled, 2 cancelled
  deadline: bigint
  label: string
  shares: Array<{ participant: string; amount: bigint; contributed: bigint }>
  myStatus: number | undefined // 0 pending invite, 1 accepted
}

export type NoticeKind = 'invite' | 'overdue' | 'due-soon' | 'waiting' | 'payment'

export interface Notice {
  key: string
  kind: NoticeKind
  billId: bigint
  title: string
  detail: string
  /** Only for bills you created that others still owe: a ready-to-send message */
  remindText?: string
}

const DAY = 86_400
const SOON = 3 * DAY

function usdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac = (raw % 1_000_000n).toString().padStart(6, '0').slice(0, 2)
  return `${whole.toLocaleString()}.${frac}`
}

export function buildNotices(
  bills: BillSnapshot[],
  me: string,
  nowSec: number,
  lastSeenPaid: Record<string, string>,
  shareLink: (id: bigint) => string,
): Notice[] {
  const mine = me.toLowerCase()
  const out: Notice[] = []

  for (const b of bills) {
    const name = b.label || `Bill #${b.id.toString()}`
    const myShare = b.shares.find(s => s.participant.toLowerCase() === mine)
    const isCreator = b.creator.toLowerCase() === mine
    const deadline = Number(b.deadline)

    if (b.status !== 0) continue

    // Invitation waiting for an answer
    if (myShare && !isCreator && b.myStatus === 0) {
      out.push({
        key: `invite-${b.id}`, kind: 'invite', billId: b.id,
        title: `Invited to ${name}`,
        detail: `Your share is ${usdc(myShare.amount)} USDC. Accept or decline it.`,
      })
      continue
    }

    // Money you still owe
    if (myShare && (isCreator || b.myStatus === 1)) {
      const remaining = myShare.amount - myShare.contributed
      if (remaining > 0n && deadline > 0) {
        if (deadline < nowSec) {
          out.push({
            key: `overdue-${b.id}`, kind: 'overdue', billId: b.id,
            title: `${name} is overdue`,
            detail: `You still owe ${usdc(remaining)} USDC. The deadline has passed.`,
          })
        } else if (deadline - nowSec <= SOON) {
          const days = Math.max(1, Math.ceil((deadline - nowSec) / DAY))
          out.push({
            key: `due-${b.id}`, kind: 'due-soon', billId: b.id,
            title: `Pay ${usdc(remaining)} USDC for ${name}`,
            detail: days <= 1 ? 'Due within a day.' : `Due in ${days} days.`,
          })
        }
      }
    }

    // Bills you created that others still owe
    if (isCreator) {
      const owing = b.shares.filter(s => s.participant.toLowerCase() !== mine && s.amount > s.contributed)
      if (owing.length > 0) {
        const left = b.totalAmount - b.amountPaid
        out.push({
          key: `waiting-${b.id}`, kind: 'waiting', billId: b.id,
          title: `${name}: waiting on ${owing.length} ${owing.length === 1 ? 'person' : 'people'}`,
          detail: `${usdc(left)} USDC still to collect.`,
          remindText: `Reminder: please pay your share of "${name}" on Fairtab. ${usdc(left)} USDC is still outstanding. ${shareLink(b.id)}`,
        })
      }
    }

    // New payments since the last time the list was opened
    const seen = lastSeenPaid[b.id.toString()]
    if ((isCreator || b.payee.toLowerCase() === mine) && seen !== undefined && BigInt(seen) < b.amountPaid) {
      out.push({
        key: `paid-${b.id}-${b.amountPaid}`, kind: 'payment', billId: b.id,
        title: `New payment on ${name}`,
        detail: `${usdc(b.amountPaid - BigInt(seen))} USDC came in.`,
      })
    }
  }
  return out
}
