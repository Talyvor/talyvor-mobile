import type { StatementLine } from '@talyvor/bff-client'

// B59.35 — what the Activity screen (src/app/activity.tsx) filters and the period it reads.

/** The web's kinds of line (suite AgentBank STATEMENT_KINDS), less those in areas the launch pack hides. */
export const ACTIVITY_KINDS: readonly { label: string; kinds: readonly string[] }[] = [
  { label: 'Every kind', kinds: [] },
  { label: 'Funded', kinds: ['fund'] },
  { label: 'Taken back', kinds: ['withdraw'] },
  { label: 'Top-ups', kinds: ['topup'] },
  { label: 'Requests', kinds: ['spend', 'hold', 'settle', 'release'] },
  { label: 'Platform fees', kinds: ['platform_fee'] },
  { label: 'Payments', kinds: ['pay'] },
  { label: 'Transfers', kinds: ['transfer', 'reversal'] },
  { label: 'Card', kinds: ['card'] },
]

export const day = (d: Date) => d.toISOString().slice(0, 10)

/** [from, to) of this month or last, YYYY-MM-DD at midnight UTC, as the statement reads it. */
export function monthPeriod(which: 'this' | 'last', now = new Date()) {
  const back = which === 'last' ? 1 : 0
  return {
    from: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))),
    to: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1))),
  }
}

/** The lines a filter keeps: one agent's or every agent's, of one kind or every kind, whose words hold the search. */
export function filterLines(lines: readonly StatementLine[], f: { agent: string | null; kinds: readonly string[]; q: string }): StatementLine[] {
  const q = f.q.trim().toLowerCase()
  return lines
    .filter((l) => f.agent === null || l.account === `agent:${f.agent}`)
    .filter((l) => f.kinds.length === 0 || f.kinds.includes(l.kind))
    .filter((l) => q === '' || [l.label, l.memo, l.counterparty, l.kind].some((w) => w?.toLowerCase().includes(q)))
    .sort((a, b) => b.at.localeCompare(a.at))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** When a line moved, as Pocket's statement writes it, on the phone's clock: "Today, 10:24", "Yesterday, 11:12", "21 Oct, 16:12". */
export function when(at: string, now = new Date()): string {
  const d = new Date(at)
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000)
  if (days === 0) return `Today, ${clock}`
  if (days === 1) return `Yesterday, ${clock}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock}`
}

/** `today at 10:31`, or `14 Oct` on another day: when an approval was decided or a payment asked, as Pocket writes it. */
export function onDay(at: string, now = new Date()): string {
  const d = new Date(at)
  if (d.toDateString() !== now.toDateString()) return `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return `today at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The month a period reads, by name: "November". */
export const monthName = (from: string) => new Date(`${from}T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
