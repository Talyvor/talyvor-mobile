import { BffError } from '@talyvor/bff-client'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'

import { FieldError } from '@/components/country-field'
import { PasscodePad } from '@/components/passcode-pad'
import { Body, Card, Eyebrow, Toggle } from '@/components/ui'
import { DOOR_WORDS, doorRefusal } from '@/door-words'
import { faceIDUnlocks, hasSignInKey, keysAvailable, setFaceIDUnlocks, thisPhoneDevice, turnOnFaceID } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.27 — Settings, Security (Pocket Live `sub:security`): Face ID on or off for opening the app. Off keeps the key, so
// on again asks for nothing; a phone with no key yet makes one, with the passcode as Lens's proof. A phone that already
// approves with a key made before sign-in keys existed keeps it: making another would replace the one that approves.

export const UNLOCK_WORDS = {
  title: 'Security',
  faceID: 'Unlock with Face ID',
  line: 'Your passcode opens the phone app. It never approves a payment.',
  keyFirst: 'This phone approves with a key made before Face ID could open the app. Turn approving off in Approvals, then on here.',
}

export function UnlockSettings() {
  const { client, person } = useSession()
  const { c } = useTheme()
  const [on, setOn] = useState<boolean | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState('')
  const [round, setRound] = useState(0)
  const [version, setVersion] = useState(0)
  const read = () => setVersion((n) => n + 1)
  useEffect(() => {
    let live = true
    void Promise.all([faceIDUnlocks(), hasSignInKey(), thisPhoneDevice()]).then(([unlocks, key, approves]) => {
      if (!live) return
      setOn(unlocks)
      setBlocked(!key && !!approves)
    })
    return () => {
      live = false
    }
  }, [version])
  if (!person || on === null || !keysAvailable()) return null

  const change = async (next: boolean) => {
    setFailed('')
    if (!next) return void (await setFaceIDUnlocks(false), read())
    if (await hasSignInKey()) return void (await setFaceIDUnlocks(true), read())
    setAsking(true)
  }
  const make = async (passcode: string) => {
    try {
      await turnOnFaceID(client, passcode)
      setAsking(false)
    } catch (err) {
      setFailed(err instanceof BffError ? doorRefusal(err) : DOOR_WORDS.failed)
      setRound((n) => n + 1)
    }
    read()
  }

  return (
    <>
      <Eyebrow>{UNLOCK_WORDS.title}</Eyebrow>
      <Card>
        <Toggle label={UNLOCK_WORDS.faceID} value={on} disabled={blocked || asking} onValueChange={(v) => void change(v)} />
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink2 }}>{blocked ? UNLOCK_WORDS.keyFirst : UNLOCK_WORDS.line}</Text>
        {asking ? (
          <View>
            <Body>{DOOR_WORDS.enter.title}</Body>
            <PasscodePad onDone={make} reset={round} />
          </View>
        ) : null}
        {failed ? <FieldError>{failed}</FieldError> : null}
      </Card>
    </>
  )
}
