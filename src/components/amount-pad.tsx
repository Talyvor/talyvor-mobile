import { formatMinor } from '@talyvor/bff-client'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Icon } from '@/components/icon'
import { fonts, useTheme } from '@/theme'

// B57.183 — Pocket Live's amount keypad (`payAmount`): 1 to 9, the decimal point, 0 and Delete, keys 70 high and round,
// 300 wide at most, as the passcode pad draws them (B57.185). What is typed is the amount as text, in the account's
// currency; the screen reads it with amountMinor, so the pad never makes a number of its own.

/** How many places a currency is typed to: USDC six, every other two. */
const placesOf = (currency: string) => (currency === 'USDC' ? 6 : 2)

/** The typed amount after one key, as Pocket Live's typeAmt: one point, the currency's places at most, no leading zero,
 * seven digits at most. */
export function typeAmount(typed: string, key: string, currency: string): string {
  if (key === 'del') return typed.slice(0, -1)
  if (key === '.') return typed.includes('.') ? typed : (typed || '0') + '.'
  if (typed.includes('.') && typed.split('.')[1].length >= placesOf(currency)) return typed
  if (typed === '0') return key
  if (typed.replace('.', '').length >= 7) return typed
  return typed + key
}

/** "12345.6", USD → "$12,345.6"; "" → "$0"; USDC → "42 USDC": the amount as it is being typed, the currency's sign kept. */
export function shownAmount(typed: string, currency: string): string {
  const [whole, part] = typed.split('.')
  const digits = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (typed.includes('.') ? '.' + (part ?? '') : '')
  const [before, after = ''] = formatMinor(0, currency).split(/0\.0+/)
  return before + digits + after
}

export function AmountPad({ typed, currency, onType }: { typed: string; currency: string; onType: (next: string) => void }) {
  const { c } = useTheme()
  const key = (k: string, label: string, child: ReactNode) => (
    <Pressable
      key={k}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onType(typeAmount(typed, k, currency))}
      style={({ pressed }) => ({
        flex: 1,
        height: 70,
        borderRadius: 35,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.tint : 'transparent',
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}>
      {child}
    </Pressable>
  )
  const glyph = (g: string) => <Text style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: c.ink, fontVariant: ['tabular-nums'] }}>{g}</Text>
  const digit = (n: string) => key(n, n, glyph(n))
  const rows: ReactNode[][] = [
    ['1', '2', '3'].map(digit),
    ['4', '5', '6'].map(digit),
    ['7', '8', '9'].map(digit),
    [key('.', 'Decimal point', glyph('.')), digit('0'), key('del', 'Delete', <Icon name="del" size={26} color={c.ink} />)],
  ]
  return (
    <View style={{ width: '100%', maxWidth: 300, alignSelf: 'center', gap: 6 }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 22 }}>
          {row}
        </View>
      ))}
    </View>
  )
}
