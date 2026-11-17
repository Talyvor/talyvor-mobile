import { BffError } from '@talyvor/bff-client'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Body, Row } from '@/components/ui'
import { useSession } from '@/session'
import { COUNTRY_NOT_SERVED, PROFILE_LABELS, servedCountries } from '@/signup-words'
import { fonts, useTheme } from '@/theme'

// country-field.tsx — sign-up's Country and its red line (B59.9), shared with the company details (B59.32), which ask
// for the same country from the same list. B61.111: the list is the countries Lens serves (suite B61.110 on the web).

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

/** B61.111 — the countries Lens serves, by the app's own names; the app's own list until Lens has said. */
function useServedCountries() {
  const { client } = useSession()
  const [served, setServed] = useState<string[] | undefined>(undefined)
  useEffect(() => {
    let live = true
    client.servedCountries().then((got) => live && setServed(got), () => undefined)
    return () => {
      live = false
    }
  }, [client])
  return servedCountries(served)
}

/** B61.111 — Lens's sentence when it refused the country (country_not_served), for the country field; null otherwise. */
export function countryRefusal(err: unknown): string | null {
  return err instanceof BffError && err.code === COUNTRY_NOT_SERVED && err.sentence ? err.sentence : null
}

/** Country: the countries Lens serves, opened in place. `label` names it where it asks something else (B61.21's country
 * lived in); `error` is its red line. */
export function CountryField({ value, onChange, label = PROFILE_LABELS.country, error }: { value: string; onChange: (code: string) => void; label?: string; error?: string }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const countries = useServedCountries()
  const picked = countries.find(([code]) => code === value)?.[1]
  return (
    <View testID="country-field" style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={picked ? { text: picked } : undefined}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 48, borderRadius: 14, borderWidth: 1.5, borderColor: c.control, backgroundColor: c.page, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: picked ? c.ink : c.ink3 }}>{picked ?? label}</Text>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chev" size={16} color={c.ink2} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ borderRadius: 14, backgroundColor: c.cloud, paddingHorizontal: 14 }}>
          {countries.map(([code, name], i) => (
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
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  )
}
