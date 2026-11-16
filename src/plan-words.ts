import type { PlanLadders } from '@talyvor/bff-client'

// plan-words.ts — B61.60: Settings, Plan's words, copied word for word from the web's (talyvor-suite B61.59,
// apps/web/src/areas/lens/PlanSettings.tsx and components/PageLinks.tsx at 6a44d8b), so the phone and the web say the same
// thing. A change to one is a change to both: src/__tests__/plan.test.tsx holds the web's strings. Every figure on the
// page is Lens's: none is written here.

export const PLAN_WORDS = {
  title: 'Plan',
  reading: 'Reading your plan…',
  signInToRead: 'Your plan can’t be read until you sign in again.',
  readFailed: 'Couldn’t read your plan just now, so no plan is shown.',
  yourPlan: 'Your plan',
  youAreOn: (name: string) => `You are on ${name}.`,
  aMonth: 'a month',
  byContract: 'By contract',
  agents: 'Agents',
  people: 'People',
  exchange: 'Exchange',
  onContract: 'This account is on a contract with Talyvor, which sets its plan.',
  forPerson: 'Plans for a person',
  forCompany: 'Plans for a company',
  laddersFailed: 'The plans couldn’t be read just now, so none is shown.',
  change: 'Change plan',
  custom: 'Custom: talk to us',
  changeTo: (name: string) => `Change to ${name}`,
  changeToAsk: (name: string) => `Change to ${name}?`,
  changing: 'Changing…',
  cancel: 'Cancel',
  /** The web's snack after a change: its title and its line. */
  nowOn: (name: string) => `You are on ${name}`,
  changed: 'Your plan changed now.',
  signInToChange: 'Sign in again to change your plan.',
  notChanged: 'Your plan was not changed. You can try again.',
  noExchangeFee: 'No exchange fee',
  /** The Sandbox sentence, beside its label, while a plan costs nothing. */
  sandbox: 'In Sandbox a plan costs nothing. The price is what it will cost when real money is live.',
} as const

/** The money capability a plan's price is paid under: spending on Talyvor itself. */
export const PLAN_CAPABILITY = 'spend_on_talyvor'

/** A count a plan allows, or "Unlimited" for -1. */
export const formatLimit = (n: number) => (n < 0 ? 'Unlimited' : n.toLocaleString('en-US'))

/** Basis points as a percent, every significant digit kept: 550 → "5.5%", 25 → "0.25%". */
export const formatBPS = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

const countOf = (n: number, one: string, many: string) => (n < 0 ? `Unlimited ${many}` : `${formatLimit(n)} ${n === 1 ? one : many}`)
export const agentsOf = (n: number) => countOf(n, 'agent', 'agents')
export const peopleOf = (n: number) => countOf(n, 'person', 'people')

/** "5 of 11", or "5 of unlimited". */
export const agentsUsed = (used: number, allowed: number) => `${formatLimit(used)} of ${allowed < 0 ? 'unlimited' : formatLimit(allowed)}`

/** The exchange fee Lens charges on a plan, as its fees read states it; null when it was not read. */
export function exchangeFee(fxMarginBps: Record<string, number> | undefined, plan: string): string | null {
  const bps = fxMarginBps?.[plan]
  if (typeof bps !== 'number') return null
  return bps === 0 ? PLAN_WORDS.noExchangeFee : `${formatBPS(bps)} on exchange`
}

/** A plan's monthly price in currency, or null where Lens states none (Custom, by contract). */
export function priceIn(prices: Record<string, number> | null | undefined, currency: string): number | null {
  const n = prices?.[currency]
  return typeof n === 'number' ? n : null
}

const FIAT_ORDER = ['USD', 'EUR', 'GBP']

/** The currency the account's plan is priced in: a stablecoin account's is the one Lens names; otherwise the account's
 * own (its first fiat account, as New agent picks it), where Lens prices plans in it. */
export function planCurrency(ladders: PlanLadders, stablecoin: boolean, ownCurrencies: readonly string[]): string {
  if (stablecoin) return ladders.stablecoin_priced_in
  const own = ownCurrencies.filter((c) => FIAT_ORDER.includes(c)).sort((a, b) => FIAT_ORDER.indexOf(a) - FIAT_ORDER.indexOf(b))[0]
  return own && ladders.currencies.includes(own) ? own : ladders.stablecoin_priced_in
}
