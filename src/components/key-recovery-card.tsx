import { refusalText, type KeyRecovery } from '@talyvor/bff-client'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'

import { useSession } from '../session'
import { useTheme } from '../theme'
import { Body, Button, Card } from './ui'

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
 * read fails. */
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
    <Card>
      <Body>
        {recovery.mine ? 'You' : 'The owner'} started a recovery. A new key can be added from {date} at {time}.
      </Body>
      {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
      <Button label="Cancel recovery" disabled={busy} onPress={() => void cancel()} />
    </Card>
  )
}
