import { BffError, refusalText, type KeyEnrolment } from '@talyvor/bff-client'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { View } from 'react-native'

import { keyGone, keyGoneText, phoneKey, signWithThisPhone } from '../keys'
import { useSession } from '../session'
import { useTheme } from '../theme'
import { Body, Button, Card } from './ui'

/** B55.4 — the keys waiting to join the workspace (Lens B55.1), which this phone's key lets in or turns away. Read each
 * time Approvals opens, as a key_enrolment push opens it; shown only while this phone's key is on here, since only a key
 * the workspace has can sign one in. */
export function KeyEnrolmentCards({ onWaiting }: { onWaiting: (n: number) => void }) {
  const { client } = useSession()
  const [waiting, setWaiting] = useState<KeyEnrolment[]>([])
  const load = useCallback(() => {
    let live = true
    phoneKey(client)
      .then(async (key) => (key?.here ? ((await client.enrolments()).enrolments ?? []).filter((e) => e.status === 'waiting') : []))
      .then((list) => live && (setWaiting(list), onWaiting(list.length)), () => undefined)
    return () => {
      live = false
    }
  }, [client, onWaiting])
  useFocusEffect(load)
  return waiting.map((e) => <KeyEnrolmentCard key={e.id} enrolment={e} onDecided={load} />)
}

function KeyEnrolmentCard({ enrolment, onDecided }: { enrolment: KeyEnrolment; onDecided: () => void }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const browser = enrolment.kind === 'passkey'

  const decide = async (approve: boolean) => {
    setBusy(true)
    setRefusal('')
    try {
      if (approve) {
        // Lens's challenge names this enrolment, so the signature lets in only the key whose code is on screen.
        const { challenge } = await client.enrolmentChallenge(enrolment.id)
        await client.approveEnrolment(enrolment.id, await signWithThisPhone(client, challenge, browser ? 'Let a browser approve payments' : 'Let a phone approve payments'))
      } else await client.declineEnrolment(enrolment.id)
      onDecided()
    } catch (err) {
      setRefusal(err instanceof BffError ? refusalText(err) : keyGone(err) ? keyGoneText : `Nothing changed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <Body>
        {browser ? 'A browser' : 'Another phone'} asks to approve payments too. Let it in only if you are adding it now and its code is {enrolment.code}.
      </Body>
      {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <Button primary label="Let it approve" disabled={busy} onPress={() => void decide(true)} />
        <Button label="Not this one" disabled={busy} onPress={() => void decide(false)} />
      </View>
    </Card>
  )
}
