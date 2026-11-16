import type { AgentRulesSave } from '@talyvor/bff-client'

import type { FaceColour } from './components/face'

// B61.37 — New agent on the phone, as the web's (talyvor-suite agentKinds.ts, B61.13): one of Talyvor's six, named by
// what it does, or the owner's own. Each of the six has its picture (the helper's colour, as the agent is drawn) and the
// rules it suggests in whole units of the account's currency, the web's amounts. The helper's own name is never shown:
// the owner names the agent. The lines are Pocket Live's (design/pocket-live texts.json, `ph na0`).

export type AgentKind = 'Research' | 'Sales' | 'Bookkeeping' | 'Ads' | 'Travel' | 'Support'

/** The four rules New agent asks for, in the order the rules screen names them; 0 is no rule. */
export const RULE_FIELDS = [
  ['perPayment', 'Per payment', 'max_per_payment_minor'],
  ['perDay', 'Per day', 'daily_limit_minor'],
  ['perMonth', 'Per month', 'monthly_limit_minor'],
  ['askAbove', 'Ask me above', 'approval_above_minor'],
] as const
export type RuleKey = (typeof RULE_FIELDS)[number][0]

export interface AgentKindChoice {
  kind: AgentKind
  /** one line on what it does */
  line: string
  colour: FaceColour
  /** whole units of the account's currency */
  rules: Record<RuleKey, number>
}

export const AGENT_KINDS: readonly AgentKindChoice[] = [
  { kind: 'Research', line: 'Finds, reads and buys data and reports', colour: 'cobalt', rules: { perPayment: 50, perDay: 200, perMonth: 2000, askAbove: 25 } },
  { kind: 'Sales', line: 'Pays for leads, tools and outreach', colour: 'orchid', rules: { perPayment: 100, perDay: 300, perMonth: 3000, askAbove: 50 } },
  { kind: 'Bookkeeping', line: 'Pays bills and keeps the books', colour: 'mint', rules: { perPayment: 500, perDay: 1000, perMonth: 5000, askAbove: 100 } },
  { kind: 'Ads', line: 'Runs and pays for your ads', colour: 'lemon', rules: { perPayment: 250, perDay: 1000, perMonth: 10000, askAbove: 100 } },
  { kind: 'Travel', line: 'Books and pays for trips', colour: 'sky', rules: { perPayment: 1500, perDay: 3000, perMonth: 6000, askAbove: 500 } },
  { kind: 'Support', line: 'Refunds and helps your customers', colour: 'rose', rules: { perPayment: 25, perDay: 100, perMonth: 1000, askAbove: 10 } },
]

/** Lens's smallest amount: one minor unit. "Ask me above" it means every payment asks. */
export const EVERY_PAYMENT_ASKS_MINOR = 1

/** The rules New agent saves, as the web's do: held in the account's currency, the four amounts in its minor units and no
 * µLXC limit. With none of the four typed, every payment waits for the owner's yes. */
export function newAgentRules(minor: Record<RuleKey, number>, currency: string): AgentRulesSave {
  const rules: AgentRulesSave = {
    currency,
    max_per_payment_minor: 0,
    hourly_limit_minor: 0,
    daily_limit_minor: 0,
    weekly_limit_minor: 0,
    monthly_limit_minor: 0,
    approval_above_minor: 0,
    allowed_models: [],
    allowed_providers: [],
    active_from: '',
    active_until: '',
    timezone: 'UTC',
  }
  for (const [key, , field] of RULE_FIELDS) rules[field] = minor[key]
  if (RULE_FIELDS.every(([key]) => minor[key] === 0)) rules.approval_above_minor = EVERY_PAYMENT_ASKS_MINOR
  return rules
}
