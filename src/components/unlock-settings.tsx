import { BffError } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { FieldError } from '@/components/country-field'
import { Icon } from '@/components/icon'
import { PasscodePad } from '@/components/passcode-pad'
import { Body, Card, Eyebrow, Note, Row, Toggle } from '@/components/ui'
import { DOOR_WORDS, doorRefusal } from '@/door-words'
import { faceIDUnlocks, hasSignInKey, keysAvailable, setFaceIDUnlocks, thisPhoneDevice, turnOnFaceID } from '@/keys'
import { useSession } from '@/session'
import { useTheme } from '@/theme'

// B61.27 — Settings, Security (Pocket Live `sub:security`): Face ID on or off for opening the app. Off keeps the key, so
// on again asks for nothing; a phone with no key yet makes one, with the passcode as Lens's proof. A phone that already
// approves with a key made before sign-in keys existed keeps it: making another would replace the one that approves.
// B57.185 — drawn as Pocket Live's `sub:security`: the setting as a row with its line under it and the switch beside,
// then the note with its shield.
// B61.109 — "Change passcode" first, as Pocket Live draws it, to /settings/passcode.

export const UNLOCK_WORDS = {
  title: 'Security',
  faceID: 'Unlock with Face ID',
  sub: 'This phone’s key never leaves it',
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
  if (!person || on === null) return null
  const change = (
    <Row
      first
      title={DOOR_WORDS.change.title}
      sub={DOOR_WORDS.change.line}
      right={<Icon name="chev" size={16} color={c.ink3} />}
      onPress={() => router.push('/settings/passcode')}
    />
  )
  if (!keysAvailable())
    return (
      <>
        <Eyebrow>{UNLOCK_WORDS.title}</Eyebrow>
        <Card>{change}</Card>
        <Note icon="shield">{UNLOCK_WORDS.line}</Note>
      </>
    )

  const turn = async (next: boolean) => {
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
        {change}
        <Toggle label={UNLOCK_WORDS.faceID} sub={blocked ? UNLOCK_WORDS.keyFirst : UNLOCK_WORDS.sub} value={on} disabled={blocked || asking} onValueChange={(v) => void turn(v)} />
        {asking ? (
          <View>
            <Body>{DOOR_WORDS.enter.title}</Body>
            <PasscodePad onDone={make} reset={round} />
          </View>
        ) : null}
        {failed ? <FieldError>{failed}</FieldError> : null}
      </Card>
      <Note icon="shield">{UNLOCK_WORDS.line}</Note>
    </>
  )
}
