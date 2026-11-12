import type { StatementLine } from '@talyvor/bff-client'

// B57.73 — what the Statement tab (src/app/(tabs)/statement.tsx) writes for each line, in the web's words (suite
// AgentBank lineText and AgentStatement lineWhat, B57.24): a model's day as the model and its requests, its platform fee
// the line under it, and every other line what it was and whether it settled.

/** What a line was, in the web's words; a kind Lens added since says only which way the money moved. */
export function lineText(l: StatementLine, nameOf: (id: string) => string): string {
  const out = l.amount_ulxc < 0
  const other = l.counterparty.startsWith('agent:') ? nameOf(l.counterparty.slice(6)) : 'another agent'
  switch (l.kind) {
    case 'fund':
      return 'Funded by the workspace'
    case 'withdraw':
      return 'Taken back by the workspace'
    case 'topup':
      return 'Topped up automatically by the workspace'
    case 'pay':
      return out ? `Paid ${other}` : `Received from ${other}`
    case 'transfer':
      return out ? `Transferred to ${other}` : `Transfer from ${other}`
    case 'reversal':
      return out ? `Given back to ${other}` : `Returned by ${other}`
    case 'card':
      return out ? 'Card charge' : 'Card refund'
    case 'spend':
      return 'Spent on a request'
    case 'hold':
      return 'Held for a request'
    case 'release':
      return 'Released after a request'
    case 'settle':
      return 'Settled a request'
    case 'platform_fee':
      return l.label || (out ? 'Money out' : 'Money in')
    default:
      return out ? 'Money out' : 'Money in'
  }
}

/** A line's title and the words after its agent and time: "Claude Sonnet 5" and "312 requests today", "Platform fee
 * 5.5%" and "On those requests", "Funded by the workspace" and "Settled". `today` is YYYY-MM-DD in the statement's zone. */
export function lineWhat(l: StatementLine, nameOf: (id: string) => string, modelOf: (id: string) => string, today: string): [string, string] {
  if (l.kind === 'platform_fee' && l.day) return [lineText(l, nameOf), l.memo ?? '']
  if (l.day && l.model && l.requests !== undefined) {
    const n = `${l.requests.toLocaleString('en-GB')} request${l.requests === 1 ? '' : 's'}`
    return [modelOf(l.model), l.day === today ? `${n} today` : n]
  }
  return [lineText(l, nameOf), l.kind === 'hold' ? 'Held' : 'Settled']
}

/** YYYY-MM-DD of `d` in `zone`, the form Lens's grouped `day` takes; UTC when the phone cannot read the zone. */
export function dayIn(d: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** The agent a statement account is, or null for one that is not an agent's. */
export const agentOf = (account: string) => (account.startsWith('agent:') ? account.slice(6) : null)
