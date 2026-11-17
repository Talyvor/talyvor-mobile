import { formatMinor, type CurrencyAccount } from '@talyvor/bff-client'
import { Text, View } from 'react-native'

import type { Shows } from '../account'
import { fonts, useTheme } from '../theme'
import { balancesByCurrency, CURRENCY_NAME, isStablecoin } from './home'
import { Body, Card, Eyebrow, Figure, Row } from './ui'

// B59.33 — Wallets: what the company's account and each agent's hold, by the workspace's kind of money (SPEC 3.3). Fiat
// only has the fiat side, Stablecoin and crypto only the stablecoin side, Hybrid both side by side, fiat first, each
// named with the kind's short word as Home and the switcher name it (design P5 and W2). A side the kind does not have is
// not rendered. B57.156 — drawn as Pocket Live's Balances: a row per currency, its sign, what it holds and what the
// agents hold of it; each agent's own figure is under Your agents.

export type Side = 'fiat' | 'stablecoin'

const SIDE_WORD: Record<Side, string> = { fiat: 'Fiat', stablecoin: 'Stablecoin' }

/** Each side the kind shows: what each currency holds across it, and its accounts, the company's first. */
export function walletSides(accounts: readonly CurrencyAccount[], shows: Pick<Shows, 'bankTransfers' | 'onChain'>) {
  const sides: Side[] = [...(shows.bankTransfers ? (['fiat'] as const) : []), ...(shows.onChain ? (['stablecoin'] as const) : [])]
  return sides.map((side) => {
    const own = accounts.filter((a) => isStablecoin(a.currency) === (side === 'stablecoin'))
    return {
      side,
      totals: balancesByCurrency(own, shows),
      accounts: [...own].sort((a, b) => Number(b.purpose === 'company') - Number(a.purpose === 'company') || a.name.localeCompare(b.name)),
    }
  })
}

/** A currency's mark in its row: its sign, or a stablecoin's first letter, as Pocket Live's Balances draws it. */
const SIGN: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }

/** B57.156 — what the agents hold of a currency, or that it is all the owner's: the line under each currency (Pocket Live). */
export const heldWords = (accounts: readonly CurrencyAccount[], currency: string) => {
  const held = accounts.filter((a) => a.currency === currency && a.purpose === 'agent').reduce((t, a) => t + a.live_minor, 0)
  return held ? `Agents hold ${formatMinor(held, currency)}` : 'All yours'
}

/** One side: its word, then a row per currency with what it holds and what the agents hold of it (Pocket Live's Balances). */
export function WalletSide({ side, totals, accounts }: ReturnType<typeof walletSides>[number]) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 12 }}>
      <Eyebrow>{SIDE_WORD[side]}</Eyebrow>
      {totals.length === 0 ? (
        <Body muted>{side === 'fiat' ? 'Add money to get started.' : 'Receive stablecoins to get started.'}</Body>
      ) : (
        <Card white>
          {totals.map(({ currency, minor }, i) => {
            const name = CURRENCY_NAME[currency] ?? currency
            const amount = formatMinor(minor, currency)
            const sub = heldWords(accounts, currency)
            const sign = (
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.cloud, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{SIGN[currency] ?? currency.charAt(0)}</Text>
              </View>
            )
            return (
              <View key={currency} accessible accessibilityLabel={`${name}, ${amount}, ${sub}`}>
                <Row first={i === 0} left={sign} title={name} sub={sub} right={<Figure>{amount}</Figure>} />
              </View>
            )
          })}
        </Card>
      )}
    </View>
  )
}
