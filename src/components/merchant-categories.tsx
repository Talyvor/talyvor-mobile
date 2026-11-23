import { MERCHANT_CATEGORIES, merchantCategoryName } from '@talyvor/bff-client'
import { Pressable, Text, View } from 'react-native'

import { fonts, useTheme } from '../theme'

// B61.120 — the Merchants and categories choices on the phone, as the web's (talyvor-suite B61.64): Lens's seven
// categories in its order, each pressed to let the agent pay in it by card; a code Lens holds that is not one of them is
// a choice too. Cloud when off, white with a 2px ink ring when on, as New agent's choices are drawn.

export function MerchantChoices({ label, chosen, onChange, disabled }: { label: string; chosen: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const { c } = useTheme()
  const choices = [...MERCHANT_CATEGORIES.map((m) => m.id as string), ...chosen.filter((id) => !MERCHANT_CATEGORIES.some((m) => m.id === id))]
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {choices.map((id) => {
        const on = chosen.includes(id)
        const name = merchantCategoryName(id)
        return (
          <Pressable
            key={id}
            accessibilityRole="checkbox"
            accessibilityLabel={name}
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(on ? chosen.filter((x) => x !== id) : [...chosen, id])}
            style={{
              minHeight: 36,
              justifyContent: 'center',
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: on ? c.page : c.cloud,
              borderWidth: 2,
              borderColor: on ? c.ink : 'transparent',
              opacity: disabled ? 0.6 : 1,
            }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{name}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
