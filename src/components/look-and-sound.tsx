import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Icon, type IconName } from '@/components/icon'
import { BottomSheet } from '@/components/pay-sheet'
import { Card, Row, Toggle } from '@/components/ui'
import { setLook, useLook, type Look } from '@/look'
import { setSoundsOn, useSoundsOn } from '@/sound'
import { fonts, useTheme } from '@/theme'

// B61.127 — Settings › Look and sound (Pocket Live `sheet:appearance`, DESIGN.md section 15; it was "Appearance"): the
// row says what is chosen, and its sheet has the three looks and the Sounds switch, on by default.

export const LOOK_WORDS = {
  title: 'Look and sound',
  row: { phone: 'Follows your phone', light: 'Light', dark: 'Dark' } satisfies Record<Look, string>,
  soundsOn: ', sounds on',
  soundsOff: ', sounds off',
  looks: [
    { look: 'phone', title: 'Follow my phone', line: 'Light by day, dark by night' },
    { look: 'light', title: 'Light' },
    { look: 'dark', title: 'Dark' },
  ] as const satisfies readonly { look: Look; title: string; line?: string }[],
  sounds: 'Sounds',
  soundsLine: 'Soft sounds when money moves. Your phone’s silent switch still mutes them',
}

export function LookAndSound() {
  const { c } = useTheme()
  const look = useLook()
  const sounds = useSoundsOn()
  const [open, setOpen] = useState(false)
  const tile = { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.cloud2 }
  return (
    <>
      <Card>
        <Row
          first
          left={
            <View style={tile}>
              <Icon name="sun" size={18} color={c.ink} />
            </View>
          }
          title={LOOK_WORDS.title}
          sub={LOOK_WORDS.row[look] + (sounds ? LOOK_WORDS.soundsOn : LOOK_WORDS.soundsOff)}
          right={<Icon name="chev" size={16} color={c.ink3} />}
          onPress={() => setOpen(true)}
        />
      </Card>
      <BottomSheet visible={open} edge={false} testID="look-and-sound-sheet" onClose={() => setOpen(false)}>
        <View style={{ gap: 14 }}>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: c.ink }}>
            {LOOK_WORDS.title}
          </Text>
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {LOOK_WORDS.looks.map((l) => (
              <Pick key={l.look} picked={look === l.look} title={l.title} line={'line' in l ? l.line : undefined} onPick={() => void setLook(l.look)} />
            ))}
          </View>
          <Card>
            <Toggle label={LOOK_WORDS.sounds} sub={LOOK_WORDS.soundsLine} value={sounds} onValueChange={(on) => void setSoundsOn(on)} />
          </Card>
        </View>
      </BottomSheet>
    </>
  )
}

/** One look: radio semantics, the dot leading, as Pocket Live's `.pick`; `icon` is the mark at its end (B61.135). */
export function Pick({ picked, title, line, icon, onPick }: { picked: boolean; title: string; line?: string; icon?: IconName; onPick: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={line ? `${title}. ${line}` : title}
      accessibilityState={{ checked: picked }}
      onPress={onPick}
      style={{ borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: picked ? c.page : c.cloud, borderWidth: 2, borderColor: picked ? c.ink : c.cloud }}>
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: picked ? c.ink : c.control, backgroundColor: picked ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {picked ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.page }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 16.5, lineHeight: 22, color: c.ink }}>{title}</Text>
        {line ? <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: c.ink2 }}>{line}</Text> : null}
      </View>
      {icon ? <Icon name={icon} color={c.ink2} /> : null}
    </Pressable>
  )
}
