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

export const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
