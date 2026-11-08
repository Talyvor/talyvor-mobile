import { BffError, refusalText } from '@talyvor/bff-client'
import { useEffect, useState } from 'react'

import { biometricName, keysAvailable, phoneKey, turnOnPhoneApprovals, workspaceName } from '../keys'
import { registerPush } from '../push'
import { useSession } from '../session'
import { useTheme } from '../theme'
import { Body, Button, Card, Eyebrow } from './ui'

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** B40.13: approving on this phone with its hardware key — off, turning on, or on. B55.53: a key made in another
 * workspace is off here, since Lens refuses it, and moving it here strands that workspace, so it asks first. */
export function PhoneKeyCard() {
  const { client } = useSession()
  const { c } = useTheme()
  const [key, setKey] = useState<Awaited<ReturnType<typeof phoneKey>> | undefined>(undefined)
  const [here, setHere] = useState('')
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  useEffect(() => {
    // Unchecked, the card shows nothing rather than a Turn on that could replace another workspace's key.
    phoneKey(client).then(setKey, () => undefined)
    void workspaceName(client).then(setHere)
  }, [client])
  if (key === undefined) return null
  // Words for a workspace the phone cannot name: the signed-in one before it is named, another it never learnt.
  const b = here || 'this workspace'
  const a = key?.owner || 'another workspace'

  const turnOn = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const device = await turnOnPhoneApprovals(client)
      setKey({ id: device.id, here: true, owner: here })
      setMoving(false)
      registerPush(client).catch((err) => console.warn('push: not registered', err))
    } catch (err) {
      setRefusal(err instanceof BffError ? refusalText(err) : `Not turned on: ${(err as Error).message}`)
      // A failed move has deleted the old key too.
      setKey(await phoneKey(client).catch(() => key))
    } finally {
      setBusy(false)
    }
  }

  const failed = refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null
  return (
    <>
      <Eyebrow>This phone</Eyebrow>
      <Card>
        <Body>Approve with {biometricName}</Body>
        {key?.here ? (
          <Body muted>On. This phone signs your approvals with a key that never leaves its secure chip and works only with {biometricName}.</Body>
        ) : key && moving ? (
          <>
            <Body>Move this phone’s key to {b}?</Body>
            <Body muted>{capital(a)} then approves on the web, or on another phone, until you move it back.</Body>
            {failed}
            <Button label={`Keep it for ${a}`} disabled={busy} onPress={() => setMoving(false)} />
            <Button primary label="Move it" disabled={busy} onPress={() => void turnOn()} />
          </>
        ) : key ? (
          <>
            <Body muted>
              Off for {b}. This phone’s key approves for {a}, and a phone holds one key.
            </Body>
            {failed}
            <Button primary label={`Use this phone for ${b}`} onPress={() => setMoving(true)} />
          </>
        ) : keysAvailable() ? (
          <>
            <Body muted>This phone makes a key in its secure chip that only {biometricName} can use, and signs your approvals with it.</Body>
            {failed}
            <Button primary label="Turn on" disabled={busy} onPress={() => void turnOn()} />
          </>
        ) : (
          <Body muted>To approve on this phone, set up Face ID or a fingerprint in the phone’s settings.</Body>
        )}
      </Card>
    </>
  )
}
