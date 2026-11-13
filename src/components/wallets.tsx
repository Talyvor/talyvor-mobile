import { formatMinor, type CurrencyAccount } from '@talyvor/bff-client'
import { Text, View } from 'react-native'

import { accountName, type Shows } from '../account'
import { fonts, useTheme } from '../theme'
import { balancesByCurrency, CURRENCY_NAME, isStablecoin } from './home'
import { Body, Card, Eyebrow, Figure, Row } from './ui'

// B59.33 — Wallets: what the company's account and each agent's hold, by the workspace's kind of money (SPEC 3.3). Fiat
// only has the fiat side, Stablecoin and crypto only the stablecoin side, Hybrid both side by side, fiat first, each
// named with the kind's short word as Home and the switcher name it (design P5 and W2). A side the kind does not have is
// not rendered.

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

/** One side: its word, a tile per currency, then each account in it with what it holds. */
export function WalletSide({ side, totals, accounts, owner }: ReturnType<typeof walletSides>[number] & { owner: string }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 12 }}>
      <Eyebrow>{SIDE_WORD[side]}</Eyebrow>
      {totals.length === 0 ? (
        <Body muted>{side === 'fiat' ? 'Top up to get started.' : 'Receive stablecoins to get started.'}</Body>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, borderRadius: 24, padding: 16, backgroundColor: c.cloud }}>
            {totals.map(({ currency, minor }) => {
              const name = CURRENCY_NAME[currency] ?? currency
              const amount = formatMinor(minor, currency).replace(` ${currency}`, '')
              return (
                <View key={currency} accessible accessibilityLabel={`${name}, ${formatMinor(minor, currency)}`} style={{ width: '33.33%', gap: 2 }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: c.ink3 }}>{name}</Text>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{amount}</Text>
                </View>
              )
            })}
          </View>
          <Card white>
            {accounts.map((a, i) => {
              const name = accountName(a, owner)
              const amount = formatMinor(a.balance_minor, a.currency)
              return (
                <View key={a.id} accessible accessibilityLabel={`${name}, ${amount}`}>
                  <Row first={i === 0} title={name} sub={CURRENCY_NAME[a.currency] ?? a.currency} right={<Figure>{amount}</Figure>} />
                </View>
              )
            })}
          </Card>
        </>
      )}
    </View>
  )
}
