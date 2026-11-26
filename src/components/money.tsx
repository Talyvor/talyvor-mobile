import { formatBalance, formatLXC, formatMinor } from '@talyvor/bff-client'
import { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import { openingNow } from '../effects'
import { durations, useReduceMotion } from '../motion'
import { fonts, useTheme } from '../theme'

// B57.64 — money as Pocket draws it: the first figure large in the display face, the one beside it small. B61.15: a
// figure is in its currency alone, so there is nothing beside it.

/** `$90.00 (a note)` → `$90.00` large and the note small; `$90.00` alone. */
export function moneyParts(written: string): { large: string; small: string | null } {
  const m = /^(.*) \((.*)\)$/.exec(written)
  return m ? { large: m[1], small: m[2] } : { large: written, small: null }
}

/**
 * B61.78 — Pocket Live's roll (DESIGN.md section 4, `roll`), as the web's B61.75: once a figure is on the screen, a new
 * value rolls from the one drawn to the new one over 700 ms, easing out on the fourth power, in whole units. The first
 * value, a change of unit and Reduce Motion draw at once. Returns the value to draw now; the roll ends on the value itself.
 * B61.130: `countUp` is one of Home's figures: drawn first as the app opens, it counts up from nothing over 700 ms, as a roll does.
 */
export function useRolled(amount: number, unit: string, countUp?: boolean): number {
  const reduce = useReduceMotion()
  const [first] = useState(() => (countUp && !reduce && openingNow() ? 0 : amount))
  const [drawn, setDrawn] = useState(first)
  const at = useRef({ drawn: first, unit })
  useEffect(() => {
    const from = at.current.drawn
    const sameUnit = at.current.unit === unit
    at.current.unit = unit
    const land = (v: number) => {
      at.current.drawn = v
      setDrawn(v)
    }
    if (from === amount || !sameUnit || reduce) return land(amount)
    const start = Date.now()
    let frame = 0
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / durations.roll)
      land(p >= 1 ? amount : Math.round(from + (amount - from) * (1 - Math.pow(1 - p, 4))))
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [amount, unit, reduce, first])
  return reduce ? amount : drawn
}

// `balance` marks a figure the owner holds, which rounds down to the cent (B59.36); an amount to approve or a charge does not.
type Amount = { micros: number; peg: number | null; balance?: boolean } | { minor: number; currency: string }

/** An amount: µLXC in dollars at the peg, or minor units of a currency ($450.00, £24.00, 400.00 USDC). B61.78: a new
 * value rolls in, and a screen reader hears the new value once, never a figure in between. */
export function Money({ size = 32, tone, countUp, ...amount }: Amount & { size?: number; tone?: string; countUp?: boolean }) {
  const { c } = useTheme()
  const micros = 'micros' in amount
  const value = micros ? amount.micros : amount.minor
  const drawn = useRolled(value, micros ? `micros:${amount.peg}` : amount.currency, countUp)
  const writtenOf = (v: number) => (micros ? (amount.balance ? formatBalance : formatLXC)(v, amount.peg) : formatMinor(v, amount.currency))
  const written = writtenOf(value)
  const { large, small } = moneyParts(drawn === value ? written : writtenOf(drawn))
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
