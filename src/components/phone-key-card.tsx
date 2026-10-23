import { BffError, refusalText } from '@talyvor/bff-client'
import { useEffect, useState } from 'react'

import { biometricName, keysAvailable, thisPhoneDevice, turnOnPhoneApprovals } from '../keys'
import { registerPush } from '../push'
import { useSession } from '../session'
import { useTheme } from '../theme'
import { Body, Button, Card, Eyebrow } from './ui'

/** B40.13: approving on this phone with its hardware key — off, turning on, or on. */
export function PhoneKeyCard() {
  const { client } = useSession()
  const { c } = useTheme()
  const [device, setDevice] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  useEffect(() => void thisPhoneDevice().then(setDevice), [])
  if (device === undefined) return null

  const turnOn = async () => {
    setBusy(true)
    setRefusal('')
    try {
      setDevice((await turnOnPhoneApprovals(client)).id)
      registerPush(client).catch((err) => console.warn('push: not registered', err))
    } catch (err) {
      setRefusal(err instanceof BffError ? refusalText(err) : `Not turned on: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Eyebrow>This phone</Eyebrow>
      <Card>
        <Body>Approve with {biometricName}</Body>
        {device ? (
          <Body muted>On. This phone signs your approvals with a key that never leaves its secure chip and works only with {biometricName}. Signing out deletes it.</Body>
        ) : keysAvailable() ? (
          <>
            <Body muted>This phone makes a key in its secure chip that only {biometricName} can use, and signs your approvals with it.</Body>
            {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
            <Button primary label="Turn on" disabled={busy} onPress={() => void turnOn()} />
          </>
        ) : (
          <Body muted>To approve on this phone, set up Face ID or a fingerprint in the phone’s settings.</Body>
        )}
      </Card>
    </>
  )
}
