import { useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Icon } from '@/components/icon'
import { fonts, useTheme } from '@/theme'

// B61.27 — Pocket Live's passcode: six dots, then the number pad (1 to 9; Face ID or nothing; 0; delete). The digits go
// to `onDone` once six are typed and are never kept: the passcode is checked by the server, never on the phone.

const LENGTH = 6

export function PasscodePad({ onDone, faceID, disabled, reset }: {
  /** six digits typed; the dots empty again once it settles */
  onDone: (digits: string) => Promise<void> | void
  /** the Face ID key in the corner, when Face ID is on */
  faceID?: () => void
  /** while a wait runs, or a check is under way */
  disabled?: boolean
  /** changes when the screen asks for the digits again */
  reset?: unknown
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

  const key = (k: string, label: string, child: ReactNode) => (
    <Pressable
      key={k}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => (k === 'face' ? faceID?.() : press(k))}
      style={({ pressed }) => ({ width: '33.33%', height: 64, alignItems: 'center', justifyContent: 'center', opacity: pressed || disabled ? 0.5 : 1 })}>
      {child}
    </Pressable>
  )
  const digit = (n: string) => key(n, n, <Text style={{ fontFamily: fonts.uiBold, fontSize: 28, color: c.ink }}>{n}</Text>)

  return (
    <View style={{ gap: 18 }}>
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit)}
        {faceID ? key('face', 'Face ID', <Icon name="faceid" size={28} color={c.ink} />) : <View style={{ width: '33.33%', height: 64 }} />}
        {digit('0')}
        {key('del', 'Delete', <Icon name="back" size={24} color={c.ink} />)}
      </View>
    </View>
  )
}
