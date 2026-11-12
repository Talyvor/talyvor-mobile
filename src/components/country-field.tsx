import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Body, Row } from '@/components/ui'
import { COUNTRIES, PROFILE_LABELS } from '@/signup-words'
import { fonts, useTheme } from '@/theme'

// country-field.tsx — sign-up's Country and its red line (B59.9), shared with the company details (B59.32), which ask
// for the same country from the same list.

/** Red text always has an icon beside it. */
export function FieldError({ children }: { children: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name="x" size={16} color={c.danger} />
      <Body style={{ color: c.danger, flex: 1 }}>{children}</Body>
    </View>
  )
}

/** Country: the web's list, opened in place. */
export function CountryField({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const picked = COUNTRIES.find(([code]) => code === value)?.[1]
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }}>{PROFILE_LABELS.country}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={PROFILE_LABELS.country}
        accessibilityValue={picked ? { text: picked } : undefined}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 48, borderRadius: 14, borderWidth: 1.5, borderColor: c.control, backgroundColor: c.page, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: picked ? c.ink : c.ink3 }}>{picked ?? PROFILE_LABELS.country}</Text>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chev" size={16} color={c.ink2} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ borderRadius: 14, backgroundColor: c.cloud, paddingHorizontal: 14 }}>
          {COUNTRIES.map(([code, name], i) => (
            <Row
              key={code}
              first={i === 0}
              title={name}
              right={code === value ? <Icon name="check" size={16} color={c.ink} /> : undefined}
              onPress={() => {
                onChange(code)
                setOpen(false)
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}
