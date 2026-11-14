import { refusalText, type KeyRecovery } from '@talyvor/bff-client'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { Icon } from './icon'
import { Button, Card } from './ui'

/** When a waiting recovery's key can be added: "15 Nov 2026" and "15:04", in this phone's time. */
function readyWords(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

/** B55.55 — a recovery started without the code (Lens B55.48), on Home in the web's words (B55.54): who started it and
 * from when a key can be added, with Cancel recovery, which Lens lets any owner or admin do and refuses in words to
 * anyone else. Read each time Home opens, as a key_recovery_started push opens it; nothing shows while none waits or the
 * read fails. B57.146: drawn as p-home draws a card, the key in its round beside the words and Cancel recovery under them,
 * as p-approvals draws a setting whose words are too long to sit beside its button. */
export function KeyRecoveryCard() {
  const { client } = useSession()
  const { c } = useTheme()
  const [recovery, setRecovery] = useState<KeyRecovery | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const load = useCallback(() => {
    let live = true
    client.waitingRecovery().then(
      ({ recovery }) => live && setRecovery(recovery),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [client])
  useFocusEffect(load)
  if (!recovery || recovery.status !== 'waiting') return null
  const { date, time } = readyWords(recovery.ready_at)

  const cancel = async () => {
    setBusy(true)
    setRefusal('')
    try {
      await client.cancelRecovery()
      setRecovery(null)
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View testID="key-recovery">
      <Card tight>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.page, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="key" color={c.ink} />
          </View>
          <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 14, lineHeight: 19, color: c.ink }}>
            {recovery.mine ? 'You' : 'The owner'} started a recovery. A new key can be added from {date} at {time}.
          </Text>
        </View>
        {refusal ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: c.critical, marginTop: 8 }}>{refusal}</Text> : null}
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          <Button small label="Cancel recovery" disabled={busy} onPress={() => void cancel()} />
        </View>
      </Card>
    </View>
  )
}
