import { formatBalance, formatLXC, formatMinor } from '@talyvor/bff-client'
import { Text, View } from 'react-native'

import { fonts, useTheme } from '../theme'

// B57.64 — money as Pocket draws it: the first figure large in the display face, the one beside it small. The order is
// B55.27's MONEY_ORDER, read by formatLXC; this splits what it wrote and adds no switch of its own.

/** `$90.00 (900 LXC)` → `$90.00` large and `900 LXC` small; `900 LXC` alone while the peg is unread. */
export function moneyParts(written: string): { large: string; small: string | null } {
  const m = /^(.*) \((.*)\)$/.exec(written)
  return m ? { large: m[1], small: m[2] } : { large: written, small: null }
}

// `balance` marks a figure the owner holds, which rounds down to the cent (B59.36); an amount to approve or a charge does not.
type Amount = { micros: number; peg: number | null; balance?: boolean } | { minor: number; currency: string }

/** An amount: µLXC beside the peg, or minor units of a currency ($450.00, £24.00, 400.00 USDC). */
export function Money({ size = 32, tone, ...amount }: Amount & { size?: number; tone?: string }) {
  const { c } = useTheme()
  const written =
    'micros' in amount ? (amount.balance ? formatBalance : formatLXC)(amount.micros, amount.peg) : formatMinor(amount.minor, amount.currency)
  const { large, small } = moneyParts(written)
  return (
    <View accessible accessibilityLabel={written} style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
      <Text style={{ fontFamily: fonts.display, fontSize: size, letterSpacing: size >= 24 ? -0.03 * size : 0, color: tone ?? c.ink, fontVariant: ['tabular-nums'] }}>
        {large}
      </Text>
      {small ? (
        <Text style={{ fontFamily: fonts.uiMedium, fontSize: Math.max(12, Math.round(size * 0.4)), color: c.ink3, fontVariant: ['tabular-nums'] }}>{small}</Text>
      ) : null}
    </View>
  )
}
