import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { biometricName, phoneKey, resumeWithThisPhone } from '../keys'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { Icon } from './icon'
import { BottomSheet } from './pay-sheet'
import { Body, Button, Headline } from './ui'

// B57.71 — starting every agent again from the phone, as Pocket's bottom sheet (design/pocket dlg-pkilloff). Pausing is
// instant; starting again is signed over Lens's resume-all challenge with this phone's key (B55.5's resumeWithThisPhone).

const ON_WEB = `Start your agents again on the web with your passkey, or turn on Approve with ${biometricName} on this phone.`

/** Whether this phone signs for the signed-in workspace: null while it reads. */
export function useSigns(): boolean | null {
  const { client } = useSession()
  const [signs, setSigns] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    phoneKey(client).then(
      (k) => live && setSigns(!!k?.here),
      () => live && setSigns(false),
    )
    return () => {
      live = false
    }
  }, [client])
  return signs
}

/** The button that opens the sheet: "Start them with Face ID", or "Start them again" when this phone does not sign. */
export function StartEveryAgentButton({ signs, onPress, small, busy }: { signs: boolean | null; onPress: () => void; small?: boolean; busy?: boolean }) {
  const { c } = useTheme()
  const off = signs === null || !!busy
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? undefined : signs ? `Start them with ${biometricName}` : 'Start them again'}
      accessibilityState={{ disabled: off }}
      accessibilityHint={off ? (busy ? 'Starting…' : 'Reading…') : undefined}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        { height: small ? 40 : 52, borderRadius: 999, paddingHorizontal: small ? 14 : 22, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary },
        small ? { alignSelf: 'flex-start' } : { alignSelf: 'stretch' },
        (pressed || off) && { opacity: 0.6 },
      ]}>
      {signs ? <Icon name="faceid" size={small ? 16 : 20} color={c.onPrimary} /> : null}
      <Text style={{ fontFamily: fonts.uiBold, fontSize: small ? 14 : 16, color: c.onPrimary }}>{busy ? 'Starting…' : signs ? `Start them with ${biometricName}` : 'Start them again'}</Text>
    </Pressable>
  )
}

/** "Start every agent again?": with this phone's key on, Face ID signs it; off, the way to start them on the web or to turn
 * the key on. A cancelled Face ID sends nothing and says so. `onStarted` once Lens has started them. */
export function StartEveryAgentSheet({ visible, signs, onClose, onStarted }: { visible: boolean; signs: boolean | null; onClose: () => void; onStarted: () => void }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const close = () => {
    setSaid('')
    onClose()
  }

  const start = async () => {
    setBusy(true)
    setSaid('')
    const why = await resumeWithThisPhone(client, null, 'Start every agent', ON_WEB)
    setBusy(false)
    if (why) return setSaid(why)
    onStarted()
  }

  return (
    <BottomSheet visible={visible} onClose={close}>
      <Headline>Start every agent again?</Headline>
      <Body muted>An agent you paused on its own stays paused.</Body>
      {signs ? (
        <StartEveryAgentButton signs busy={busy} onPress={() => void start()} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name="faceid" size={16} color={c.ink2} />
            <Body muted style={{ flex: 1, fontSize: 13 }}>
              {ON_WEB}
            </Body>
          </View>
          <Button
            primary
            label="Approvals on this phone"
            onPress={() => {
              close()
              router.push('/approvals')
            }}
          />
        </>
      )}
      <Button variant="secondary" label="Not now" disabled={busy} hint="Starting…" onPress={close} />
      {said ? <Body style={{ color: c.danger }}>{said}</Body> : null}
    </BottomSheet>
  )
}
