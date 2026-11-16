import { BffError, refusalText, type KeyEnrolment } from '@talyvor/bff-client'
import { useFocusEffect } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import { biometricName, keyGone, keyGoneText, phoneKey, signWithThisPhone } from '../keys'
import { haptic } from '../motion'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { Icon } from './icon'
import { BottomSheet } from './pay-sheet'
import { Body, Button, Card } from './ui'

/** B55.4 — the keys waiting to join the workspace (Lens B55.1), which this phone's key lets in or turns away. Read each
 * time Approvals opens, as a key_enrolment push opens it; shown only while this phone's key is on here, since only a key
 * the workspace has can sign one in. B57.69: each waits on Approvals as p-approvals draws it, with Review; Let it approve
 * and Not this one are in Pocket's bottom sheet, which the push opens straight away for the enrolment it names (`open`). */
export function KeyEnrolmentCards({ onWaiting, open }: { onWaiting: (n: number) => void; open?: string }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [waiting, setWaiting] = useState<KeyEnrolment[]>([])
  const [reviewing, setReviewing] = useState<string>()
  // The push's enrolment, once its sheet was closed or decided, so it opens only once.
  const [shut, setShut] = useState<string>()
  const [decided, setDecided] = useState<{ title: string; line: string }>()
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
  const sheetFor = waiting.find((e) => e.id === (reviewing ?? (open !== shut ? open : undefined)))
  return (
    <>
      {decided ? (
        <Card tight>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{decided.title}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: c.ink3 }}>{decided.line}</Text>
        </Card>
      ) : null}
      {waiting.map((e) => (
        <Card key={e.id} white tight>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{asks(e)}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: c.ink3 }}>{codeLine(e)}</Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Button primary small label="Review" accessibilityLabel={`Review: ${asks(e)}`} onPress={() => (setDecided(undefined), setReviewing(e.id))} />
          </View>
        </Card>
      ))}
      {sheetFor ? (
        <KeyEnrolmentSheet
          enrolment={sheetFor}
          onClose={() => (setReviewing(undefined), setShut(open))}
          onDecided={(approved) => {
            setReviewing(undefined)
            setShut(open)
            setDecided(decidedWords(sheetFor, approved))
            load()
          }}
        />
      ) : null}
    </>
  )
}

const browser = (e: KeyEnrolment) => e.kind === 'passkey'
const asks = (e: KeyEnrolment) => `${browser(e) ? 'A browser' : 'Another phone'} asks to approve payments too.`
const codeLine = (e: KeyEnrolment) => `Let it in only if you are adding it now and its code is ${e.code}.`

/** What a decision did, in the reference's words for it (p-approvals for a browser, w-security for a phone). */
function decidedWords(e: KeyEnrolment, approved: boolean) {
  const what = browser(e) ? 'browser' : 'phone'
  if (!approved) return { title: 'Not let in', line: `The ${what} was not added. Nothing changed.` }
  return browser(e)
    ? { title: 'The browser can approve now', line: `${biometricName} signed for its new passkey.` }
    : { title: 'The phone can approve now', line: `It signs approvals with ${biometricName}.` }
}

/** Let one waiting key in, signed with this phone's key, or turn it away. A cancelled check sends no decision, and the
 * sheet stays open with why. */
export function KeyEnrolmentSheet({ enrolment, onClose, onDecided }: { enrolment: KeyEnrolment; onClose: () => void; onDecided: (approved: boolean) => void }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  // A second press before the first is answered signs nothing more.
  const deciding = useRef(false)

  const decide = async (approve: boolean) => {
    if (deciding.current) return
    deciding.current = true
    setBusy(true)
    setRefusal('')
    try {
      if (approve) {
        // Lens's challenge names this enrolment, so the signature lets in only the key whose code is on screen.
        const { challenge } = await client.enrolmentChallenge(enrolment.id)
        await client.approveEnrolment(enrolment.id, await signWithThisPhone(client, challenge, browser(enrolment) ? 'Let a browser approve payments' : 'Let a phone approve payments'))
      } else await client.declineEnrolment(enrolment.id)
      if (approve) haptic('success')
      onDecided(approve)
    } catch (err) {
      if (approve && err instanceof BffError) haptic('warning')
      setRefusal(err instanceof BffError ? refusalText(err) : keyGone(err) ? keyGoneText : `Nothing changed: ${(err as Error).message}`)
    } finally {
      deciding.current = false
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible testID="key-enrolment-sheet" onClose={() => !busy && onClose()}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.cloud, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="key" color={c.ink} />
          </View>
          <Body style={{ flex: 1, fontFamily: fonts.uiBold }}>{asks(enrolment)}</Body>
        </View>
        <Body muted>{codeLine(enrolment)}</Body>
        {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
        <Button primary icon="faceid" label="Let it approve" disabled={busy} onPress={() => void decide(true)} />
        <Button variant="secondary" label="Not this one" haptic={false} disabled={busy} onPress={() => void decide(false)} />
      </View>
    </BottomSheet>
  )
}
