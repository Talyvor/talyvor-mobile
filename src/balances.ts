import type { CurrencyAccount } from '@talyvor/bff-client'

import type { Shows } from './account'

// What Home and the home-screen widget count (B57.66, B61.44): no component here, so the widget's sync can read it.

/** A currency's name on its tile, as P3 and P4 draw them; a stablecoin is named by its code. */
export const CURRENCY_NAME: Record<string, string> = { USD: 'US dollar', EUR: 'Euro', GBP: 'British pound' }
const FIAT_ORDER = ['USD', 'EUR', 'GBP']
export const isStablecoin = (currency: string) => !(currency in CURRENCY_NAME)

/** What each currency holds across the accounts in view, the company's and each agent's, fiat first; a currency the
 * account's kind does not show is left out. */
export function balancesByCurrency(accounts: readonly CurrencyAccount[], shows: Pick<Shows, 'bankTransfers' | 'onChain'>): { currency: string; minor: number }[] {
  const sums = new Map<string, number>()
  for (const a of accounts) {
    if (isStablecoin(a.currency) ? !shows.onChain : !shows.bankTransfers) continue
    sums.set(a.currency, (sums.get(a.currency) ?? 0) + a.live_minor)
  }
  const rank = (c: string) => (isStablecoin(c) ? 10 : FIAT_ORDER.indexOf(c))
  return [...sums].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency))
}
