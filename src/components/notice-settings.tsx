import { refusalText, type NoticeSettings } from '@talyvor/bff-client'
import { useState } from 'react'
import { TextInput, View } from 'react-native'

import { useSession } from '../session'
import { NOTICE_KINDS } from '../spending'
import { fonts, useTheme } from '../theme'
import { Body, Button, Card, Toggle } from './ui'

/** When notices arrive (Lens B53.7): quiet hours and each kind on or off. Spending and Settings both draw it. */
export function NoticeSettingsCard({ initial }: { initial: NoticeSettings }) {
  const { client } = useSession()
  const { c } = useTheme()
  // What the person has changed, over Lens's settings, until they save.
  const [edits, setSettings] = useState<NoticeSettings | null>(null)
  const settings = edits ?? initial
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const save = async () => {
    setSaving(true)
    try {
      setSettings(await client.setNoticeSettings({ ...settings, timezone: settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone }))
      setSaved('Saved.')
    } catch (err) {
      setSaved(refusalText(err))
    } finally {
      setSaving(false)
    }
  }
  // B57.132 — Pocket's input (1.5 control outline at radius 14) and its switch.
  const input = { height: 46, borderWidth: 1.5, borderColor: c.control, borderRadius: 14, paddingHorizontal: 14, backgroundColor: c.page, color: c.ink, fontSize: 15, fontFamily: fonts.ui, width: 96 }

  return (
    <Card>
      <Body muted>Quiet hours hold every notice but an unusual payment until they end. Leave both empty for none.</Body>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput accessibilityLabel="Quiet from" placeholder="22:00" placeholderTextColor={c.ink3} value={settings.quiet_from} onChangeText={(v) => setSettings({ ...settings, quiet_from: v })} style={input} />
        <Body muted>to</Body>
        <TextInput accessibilityLabel="Quiet until" placeholder="07:00" placeholderTextColor={c.ink3} value={settings.quiet_until} onChangeText={(v) => setSettings({ ...settings, quiet_until: v })} style={input} />
      </View>
      {NOTICE_KINDS.map(([kind, name]) => {
        const off = settings.off ?? []
        return (
          <Toggle
            key={kind}
            label={name}
            value={!off.includes(kind)}
            onValueChange={(on) => setSettings({ ...settings, off: on ? off.filter((k) => k !== kind) : [...off, kind] })}
          />
        )
      })}
      <Button primary label={saving ? 'Saving…' : 'Save notice settings'} disabled={saving} onPress={() => void save()} />
      {saved ? <Body muted>{saved}</Body> : null}
    </Card>
  )
}
