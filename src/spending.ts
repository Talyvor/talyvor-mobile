import { formatMinor, type Spending } from '@talyvor/bff-client'

// B53.9 — the words and sums the Spending tab shares with the web's (talyvor-suite apps/web Spending.tsx and Budgets.tsx).

const CATEGORIES: Record<string, string> = {
  ai_software: 'AI and software',
  groceries: 'Groceries',
  eating_out: 'Eating out',
  transport: 'Transport',
  travel: 'Travel',
  bills: 'Bills',
  subscriptions: 'Subscriptions',
  shopping: 'Shopping',
  health: 'Health',
  entertainment: 'Entertainment',
  cash: 'Cash',
  transfers: 'Transfers to people',
  other: 'Other',
  '': 'All spending',
}
export const categoryName = (c: string) => CATEGORIES[c] ?? c.replace(/_/g, ' ')

export const RULES: Record<string, string> = {
  new_merchant: 'Somewhere new',
  above_usual: 'More than you usually pay',
  new_country: 'A new country',
  duplicate: 'Possibly paid twice',
  gambling: 'Gambling',
  agent_unusual_spend: 'An agent spending fast',
}

export const NOTICE_KINDS: readonly [string, string][] = [
  ['payment', 'Each payment'],
  ['budget', 'Budget alerts'],
  ['unusual', 'Unusual payments'],
  ['tip', 'The Coach’s daily tip'],
  ['digest', 'Monday’s weekly digest'],
  ['plan', 'When the month plan is off'],
]

/** [from, to) of this week (from Monday) or this month, at midnight on this phone, as Lens reads a period. */
export function spendPeriod(period: 'week' | 'month', now = new Date()): { from: string; to: string } {
  const start =
    period === 'week'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
      : new Date(now.getFullYear(), now.getMonth(), 1)
  const end = period === 'week' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** Each category's spend, every wallet together, as "25.00 GBP and 3.00 EUR": never added across currencies. Biggest first. */
export function byCategory(s: Spending | null | undefined): [string, string][] {
  const out = new Map<string, Map<string, number>>()
  for (const t of s?.totals ?? []) {
    for (const [cat, minor] of Object.entries(t.by_category ?? {})) {
      const cur = out.get(cat) ?? new Map<string, number>()
      cur.set(t.currency, (cur.get(t.currency) ?? 0) + minor)
      out.set(cat, cur)
    }
  }
  return [...out]
    .sort(([, a], [, b]) => Math.max(...b.values()) - Math.max(...a.values()))
    .map(([cat, cur]) => [cat, [...cur].map(([c, m]) => formatMinor(m, c)).join(' and ')])
}

/** B57.92 — each currency's spend, every wallet together, with its categories biggest first: never added across currencies. */
export function byCurrency(s: Spending | null | undefined): { currency: string; total: number; categories: [string, number][] }[] {
  const out = new Map<string, { total: number; cats: Map<string, number> }>()
  for (const t of s?.totals ?? []) {
    const cur = out.get(t.currency) ?? { total: 0, cats: new Map<string, number>() }
    cur.total += t.total_minor
    for (const [cat, minor] of Object.entries(t.by_category ?? {})) cur.cats.set(cat, (cur.cats.get(cat) ?? 0) + minor)
    out.set(t.currency, cur)
  }
  return [...out]
    .filter(([, v]) => v.total > 0)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([currency, v]) => ({ currency, total: v.total, categories: [...v.cats].sort(([, a], [, b]) => b - a) }))
}

/** What a notice's body says beyond its payment's category: "Bills" says nothing more, and "Bills · $50.00 left of …" says
 * the part after it. */
export function noticeMore(body: string, category: string | undefined): string {
  const said = body.trim()
  if (!category) return said
  const name = categoryName(category)
  if (said.toLowerCase() === name.toLowerCase()) return ''
  return said.toLowerCase().startsWith(`${name.toLowerCase()} · `) ? said.slice(name.length + 3).trim() : said
}

export const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
