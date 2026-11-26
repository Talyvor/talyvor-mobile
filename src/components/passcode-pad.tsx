import { useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'

import { keyFelt } from '@/components/amount-pad'
import { Icon } from '@/components/icon'
import { Press } from '@/components/press'
import { fonts, useTheme } from '@/theme'

// B61.27 — Pocket Live's passcode: six dots, then the number pad (1 to 9; Face ID or nothing; 0; delete). The digits go
// to `onDone` once six are typed and are never kept: the passcode is checked by the server, never on the phone.
// B57.185 — drawn as Pocket Live's .dots and .keys: keys 70 high and round, 300 wide at most, the display face at 30, a
// cloud-2 press. `spread` puts the dots under the words and the keys at the foot of the screen, as Pocket Live's lock
// and sign-up steps do; `children` sits under the dots (what the screen says back).

const LENGTH = 6

export function PasscodePad({ onDone, faceID, disabled, reset, spread, children }: {
  /** six digits typed; the dots empty again once it settles */
  onDone: (digits: string) => Promise<void> | void
  /** the Face ID key in the corner, when Face ID is on */
  faceID?: () => void
  /** while a wait runs, or a check is under way */
  disabled?: boolean
  /** changes when the screen asks for the digits again */
  reset?: unknown
  /** the keys at the foot of the screen, in a Screen that `fill`s */
  spread?: boolean
  children?: ReactNode
}) {
  const { c } = useTheme()
  const [digits, setDigits] = useState('')
  // The screen asked again: the dots empty, as the render that saw it draws them.
  const [seen, setSeen] = useState(reset)
  if (seen !== reset) {
    setSeen(reset)
    setDigits('')
  }

  const press = (k: string) => {
    if (disabled) return
    if (k === 'del') return setDigits((d) => d.slice(0, -1))
    if (digits.length >= LENGTH) return
    const next = digits + k
    setDigits(next)
    if (next.length === LENGTH) void Promise.resolve(onDone(next)).finally(() => setDigits(''))
  }

  // B61.130 — a key ripples in a tint of ink from where the finger lands; its haptic comes with its sound.
  const key = (k: string, label: string, child: ReactNode) => (
    <Press
      key={k}
      kind="key"
      haptic={false}
      ripple="ink"
      radius={35}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (k === 'face') return faceID?.()
        keyFelt()
        press(k)
      }}
      style={({ pressed }) => ({
        flex: 1,
        height: 70,
        borderRadius: 35,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.tint : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}>
      {child}
    </Press>
  )
  const digit = (n: string) =>
    key(n, n, <Text style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: c.ink, fontVariant: ['tabular-nums'] }}>{n}</Text>)
  const rows: ReactNode[][] = [
    ['1', '2', '3'].map(digit),
    ['4', '5', '6'].map(digit),
    ['7', '8', '9'].map(digit),
    [
      faceID ? key('face', 'Face ID', <Icon name="faceid" size={26} color={c.ink} />) : <View key="none" style={{ flex: 1, height: 70 }} />,
      digit('0'),
      key('del', 'Delete', <Icon name="del" size={26} color={c.ink} />),
    ],
  ]

  return (
    <View style={spread ? { flex: 1 } : { gap: 18 }}>
      <View
        accessible
        accessibilityLabel={`${digits.length} of ${LENGTH} digits typed`}
        testID="passcode-dots"
        style={{ flexDirection: 'row', gap: 14, justifyContent: 'center', height: 18, marginTop: 22, marginBottom: 6 }}>
        {Array.from({ length: LENGTH }, (_, i) => (
          <View
            key={i}
            style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < digits.length ? c.ink : 'transparent', borderWidth: i < digits.length ? 0 : 1.5, borderColor: c.control }}
          />
        ))}
      </View>
      {children}
      {spread ? <View style={{ flex: 1, minHeight: 18 }} /> : null}
      <View testID="passcode-keys" style={{ width: '100%', maxWidth: 300, alignSelf: 'center', gap: 6 }}>
        {rows.map((row, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 22 }}>
            {row}
          </View>
        ))}
      </View>
    </View>
  )
}
