import { BffError, refusalText } from '@talyvor/bff-client'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import { biometricName, keysAvailable, phoneKey, turnOffPhoneApprovals, turnOffRefusal, turnOnPhoneApprovals, waitForTheWeb, workspaceName } from '../keys'
import { registerPush } from '../push'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { BottomSheet } from './pay-sheet'
import { Body, Button, Card, Figure, Headline } from './ui'

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The code as Lens writes it, in five groups of four, however it arrives. */
const grouped = (code: string) => code.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')

/** B57.68: titled "This phone: Approve with Face ID", in Pocket's p-approvals words. B40.13: approving on this phone with its hardware key — off, turning on, or on. B55.53: a key made in another
 * workspace is off here, since Lens refuses it, and moving it here strands that workspace, so it asks first. B55.4: in a
 * workspace that already has a key, the new one waits, with its code, until the web lets it in. B55.17: Turn off asks
 * first too, and the key leaves the phone only once Lens has revoked it. B59.9: `onOn` hears when this phone's key is on
 * here, so sign-up's step 3 can open the app. B55.55: a first key comes with the workspace's recovery code (Lens B55.48),
 * shown once in the web's words (B55.54) until "I saved it", and held only in this card's state; `onOn` waits for it.
 * B57.102: another workspace's key is drawn as p-approvals draws a setting, and moving it asks in Pocket's bottom sheet. */
export function PhoneKeyCard({ onOn }: { onOn?: () => void } = {}) {
  const { client } = useSession()
  const { c } = useTheme()
  const [key, setKey] = useState<Awaited<ReturnType<typeof phoneKey>> | undefined>(undefined)
  const [here, setHere] = useState('')
  const [moving, setMoving] = useState(false)
  const [ending, setEnding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [copied, setCopied] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => void (mounted.current = false), [])
  useEffect(() => {
    // Unchecked, the card shows nothing rather than a Turn on that could replace another workspace's key.
    phoneKey(client).then(setKey, () => undefined)
    void workspaceName(client).then(setHere)
  }, [client])
  useEffect(() => {
    if (key?.here && !recoveryCode) onOn?.()
  }, [key, recoveryCode, onOn])
  if (key === undefined) return null
  // Words for a workspace the phone cannot name: the signed-in one before it is named, another it never learnt.
  const b = here || 'this workspace'
  const a = key?.owner || 'another workspace'

  const turnOn = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const made = await turnOnPhoneApprovals(client)
      if ('enrolment' in made) setCode(made.enrolment.code)
      const device = 'enrolment' in made ? await waitForTheWeb(client, made.enrolment, () => mounted.current) : made
      if (!mounted.current) return
      setCode('')
      if (!device) {
        setKey(null)
        setRefusal('This phone was not added. Nothing changed.')
        return
      }
      if (device.recovery_code) setRecoveryCode(device.recovery_code)
      setKey({ id: device.id, here: true, owner: here })
      setMoving(false)
      registerPush(client).catch((err) => console.warn('push: not registered', err))
    } catch (err) {
      if (!mounted.current) return
      setCode('')
      setRefusal(err instanceof BffError ? refusalText(err) : `Not turned on: ${(err as Error).message}`)
      // A failed move has deleted the old key too.
      setKey(await phoneKey(client).catch(() => key))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    setRefusal('')
    try {
      await turnOffPhoneApprovals(client)
      setKey(null)
      setEnding(false)
    } catch (err) {
      setRefusal(turnOffRefusal(err))
    } finally {
      setBusy(false)
    }
  }

  const failed = refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null
  const title = `This phone: Approve with ${biometricName}`
  // On or Off as Pocket's p-approvals draws them: the title and its line, the one button beside them.
  const setting = recoveryCode || code ? null : key?.here && !ending ? 'on' : !key && keysAvailable() ? 'off' : key && !key.here ? 'elsewhere' : null
  const words = (line: string, refused = false) => <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: refused ? c.critical : c.ink3 }}>{line}</Text>
  // Another workspace's key: its name is too long to sit beside the words, so the button goes under them, as p-approvals
  // draws the browser's card. The confirm is a sheet over it until the move is made or kept.
  if (setting === 'elsewhere')
    return (
      <Card tight>
        <View style={{ gap: 2 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{title}</Text>
          {words(`Off for ${b}. This phone’s key approves for ${a}, and a phone holds one key.`)}
        </View>
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <Button small label={`Use this phone for ${b}`} onPress={() => setMoving(true)} />
        </View>
        <BottomSheet visible={moving} onClose={() => !busy && setMoving(false)}>
          <Headline>Move this phone’s key to {b}?</Headline>
          <Body muted>{capital(a)} then approves on the web, or on another phone, until you move it back.</Body>
          {failed}
          <Button primary label="Move it" disabled={busy} hint="Moving…" onPress={() => void turnOn()} />
          <Button variant="secondary" label={`Keep it for ${a}`} disabled={busy} onPress={() => setMoving(false)} />
        </BottomSheet>
      </Card>
    )
  if (setting)
    return (
      <Card tight>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{title}</Text>
            {words(
              setting === 'on'
                ? `On. This phone signs your approvals with a key that never leaves its secure chip and works only with ${biometricName}.`
                : refusal || 'Off. This phone has no key, so it cannot approve or decline.',
              !!refusal,
            )}
          </View>
          {setting === 'on' ? (
            <Button
              small
              label="Turn off"
              onPress={() => {
                setRefusal('')
                setEnding(true)
              }}
            />
          ) : (
            <Button small label="Turn on" disabled={busy} hint="Turning on…" onPress={() => void turnOn()} />
          )}
        </View>
      </Card>
    )
  return (
    <>
      <Card>
        <Body style={{ fontFamily: fonts.uiBold }}>{code ? 'Waiting for the web' : title}</Body>
        {recoveryCode ? (
          <>
            <Body>Save your recovery code</Body>
            <Body muted>If you ever lose every passkey and phone, this code lets you add a new key at once. We show it only now.</Body>
            <Figure size={20}>{grouped(recoveryCode)}</Figure>
            <Button label="Copy" onPress={() => void Clipboard.setStringAsync(recoveryCode).then(() => setCopied(true))} />
            <Button
              primary
              label="I saved it"
              onPress={() => {
                // A code Copy put on the clipboard leaves it with the sheet, so another app cannot read it later.
                if (copied) void Clipboard.setStringAsync('')
                setCopied(false)
                setRecoveryCode('')
              }}
            />
          </>
        ) : code ? (
          <Body muted>In Talyvor on the web, let this phone in from Approvals and devices. The code there should be {code}.</Body>
        ) : key?.here && ending ? (
          <>
            <Body>Turn off approving on this phone?</Body>
            <Body muted>This phone’s key is removed and can no longer approve anything.</Body>
            {failed}
            <Button label="Keep it" disabled={busy} onPress={() => setEnding(false)} />
            <Button primary label="Turn it off" disabled={busy} onPress={() => void turnOff()} />
          </>
        ) : (
          <Body muted>To approve on this phone, set up Face ID or a fingerprint in the phone’s settings.</Body>
        )}
      </Card>
    </>
  )
}
