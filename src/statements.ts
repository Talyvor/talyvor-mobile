import { formatMinor, type CurrencyAccount, type MoneyStatementFormat, type MoneyStatementLine } from '@talyvor/bff-client'

// B61.135 — Statements in Activity (design/pocket-live DESIGN.md 16): what a statement can be for, the periods on offer,
// a line in a person's words, and the file's name. The words and the name are Lens's own (statement_words.go,
// statement_pdf.go brandedWith and statement_xlsx.go statementFileName), so the paper reads as the PDF does.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MON = MONTHS.map((m) => m.slice(0, 3))

/** 16.1: each kind of line in words; a kind with none is Money in or Money out by the way it moved, never the code. */
const KIND_WORDS: Record<string, string> = {
  card_charge: 'Card payment', card_refund: 'Refund', card_dispute_won: 'Dispute won', payment_out: 'Paid out',
  payment_in: 'Paid in', invoice_payment: 'Invoice paid', mandate_pull: 'Collected under a mandate',
  payout: 'Withdrawal', return: 'Returned', test_money: 'Paid in', chain_deposit: 'Paid in', agent_funding: 'Funded',
  agent_funding_back: 'Transfer', person_payment: 'Paid out', standing_order: 'Paid out', payment_in_returned: 'Returned',
  invoice_card: 'Invoice paid', invoice_card_returned: 'Returned', test_top_up: 'Paid in',
  instant_transfer_move: 'Instant transfer', instant_transfer_payout: 'Instant transfer',
}
export const kindWords = (kind: string, minor: number) => KIND_WORDS[kind] ?? (minor < 0 ? 'Money out' : 'Money in')

/** A line's state, only when it is not complete. */
export function stateWords(state?: string): '' | 'Pending' | 'Failed' | 'Returned' {
  if (state === 'pending' || state === 'sent') return 'Pending'
  if (state === 'failed') return 'Failed'
  if (state === 'returned') return 'Returned'
  return ''
}

const BALANCE_NAMES: Record<string, string> = { USD: 'US dollar balance', EUR: 'Euro balance', GBP: 'British pound balance', USDC: 'USDC balance', EURC: 'EURC balance' }
export const balanceName = (currency: string) => BALANCE_NAMES[currency] ?? `${currency} balance`

/** One account a statement can be for: a balance of the company's, or an agent's account. */
export interface StatementSource {
  id: string
  currency: string
  name: string
  /** the agent's name on an agent's statement, which its file is named by */
  agent?: string
  holds: number
}

/** The balances first, then each agent's account, as Statement for lists them. */
export function statementSources(accounts: readonly CurrencyAccount[], agentName: (id: string) => string | undefined): StatementSource[] {
  const open = accounts.filter((a) => a.status !== 'closed')
  const own = open.filter((a) => a.purpose === 'company').map((a) => ({ id: a.id, currency: a.currency, name: balanceName(a.currency), holds: a.live_minor }))
  const agents = open.filter((a) => a.purpose === 'agent' && a.agent_id)
  return own.concat(
    agents.map((a) => {
      const agent = agentName(a.agent_id!) ?? a.name
      const several = agents.filter((b) => b.agent_id === a.agent_id).length > 1
      return { id: a.id, currency: a.currency, name: several ? `${agent} · ${a.currency}` : agent, agent, holds: a.live_minor }
    }),
  )
}

/** A period on offer: its name, its dates in words, and [from, to) as YYYY-MM-DD at midnight UTC. */
export interface StatementPeriod {
  id: string
  name: string
  range: string
  from: string
  to: string
  /** it runs to today, so its last figure is the balance now */
  now: boolean
}

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/** This month so far, each full month back to January (and at least three), the last 3 months, this year so far. */
export function statementPeriods(now = new Date()): StatementPeriod[] {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  const tomorrow = ymd(y, m, d + 1)
  const out: StatementPeriod[] = [{ id: 'm0', name: `${MONTHS[m]} so far`, range: `1 to ${d} ${MONTHS[m]} ${y}`, from: ymd(y, m, 1), to: tomorrow, now: true }]
  for (let k = 1; k <= Math.max(3, m); k++) {
    const at = new Date(Date.UTC(y, m - k, 1)), yy = at.getUTCFullYear(), mm = at.getUTCMonth()
    out.push({ id: `m${k}`, name: `${MONTHS[mm]} ${yy}`, range: `1 to ${lastDay(yy, mm)} ${MONTHS[mm]} ${yy}`, from: ymd(yy, mm, 1), to: ymd(yy, mm + 1, 1), now: false })
  }
  const q = new Date(Date.UTC(y, m - 3, 1)), last = new Date(Date.UTC(y, m, 0))
  const qy = q.getUTCFullYear(), ly = last.getUTCFullYear()
  out.push({
    id: 'q3',
    name: 'Last 3 months',
    range: `1 ${MONTHS[q.getUTCMonth()]}${qy === ly ? '' : ` ${qy}`} to ${last.getUTCDate()} ${MONTHS[last.getUTCMonth()]} ${ly}`,
    from: ymd(qy, q.getUTCMonth(), 1),
    to: ymd(y, m, 1),
    now: false,
  })
  out.push({ id: 'ytd', name: `${y} so far`, range: `1 January to ${d} ${MONTHS[m]} ${y}`, from: ymd(y, 0, 1), to: tomorrow, now: true })
  return out
}

/** 16.1: talyvor-statement-USD-2026-10 for a month (a month so far too), talyvor-statement-USD-2026-08-01-to-2026-10-31
 * otherwise, the agent's name before the currency on an agent's statement; as Lens names the file it writes. */
export function statementFileName(src: Pick<StatementSource, 'currency' | 'agent'>, from: string, to: string): string {
  const slug = (src.agent ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const f = new Date(`${from}T00:00:00Z`), t = new Date(`${to}T00:00:00Z`)
  const month = f.getUTCDate() === 1 && t <= new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1))
  const when = month ? from.slice(0, 7) : `${from}-to-${new Date(t.getTime() - 86_400_000).toISOString().slice(0, 10)}`
  return ['talyvor-statement', slug, src.currency, when].filter(Boolean).join('-')
}

/** The three files, as Download statement offers them. */
export const STATEMENT_FORMATS: readonly { format: MoneyStatementFormat; name: string; line: string; icon: 'doc' | 'sheet' | 'rows' }[] = [
  { format: 'pdf', name: 'PDF', line: 'Branded, ready to print or send', icon: 'doc' },
  { format: 'xlsx', name: 'Excel', line: 'A sheet with totals that add up', icon: 'sheet' },
  { format: 'csv', name: 'CSV', line: 'Plain rows for accounting tools', icon: 'rows' },
]

// One of Lens's own keys, not words: an id ("macc_…", a UUID) or a key ("spend", "test_money:…").
const CODE_SHAPED = /^(spend|[a-z]+_[0-9A-Za-z-]{6,}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[a-z_]+:\S*)$/

/** A line as the phone's paper draws it: who it was with, else what it was; then what it was and its time (UTC). */
export function statementLine(l: MoneyStatementLine, accountName: (id: string) => string | undefined, agentName: (id: string) => string | undefined) {
  const cp = l.counterparty
  const withWho =
    cp === 'workspace' || cp.startsWith('workspace:')
      ? 'The company'
      : cp.startsWith('agent:')
        ? (agentName(cp.slice(6)) ?? '')
        : (accountName(cp) ?? (CODE_SHAPED.test(cp) ? '' : cp))
  const what = kindWords(l.kind, l.amount_minor)
  const at = new Date(l.at)
  const time = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
  return {
    key: `${l.entry_id}-${l.line}`,
    day: at.getUTCDate(),
    month: MON[at.getUTCMonth()],
    name: withWho || what,
    sub: [withWho ? what : '', time].filter(Boolean).join(' · '),
    state: stateWords(l.state),
    task: l.task ?? '',
    minor: l.amount_minor,
    balance: l.balance_after_minor,
  }
}

/** How a statement adds up, written out under its last line. */
export const addsUp = (o: { opening: number; in: number; out: number; closing: number }, currency: string) =>
  [`${formatMinor(o.opening, currency)} opening + ${formatMinor(o.in, currency)} in − ${formatMinor(o.out, currency)} out = `, formatMinor(o.closing, currency)] as const
