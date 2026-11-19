import { BffError } from '@talyvor/bff-client'
import { Image } from 'expo-image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, Text, View } from 'react-native'

import { PasscodePad } from '@/components/passcode-pad'
import { Body, Button, Headline, Screen } from '@/components/ui'
import { DOOR_WORDS, doorRefusal, waitLeft } from '@/door-words'
import { openHelpMail } from '@/help-words'
import { faceIDUnlocks } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.27 — Pocket Live's `lock`: the app's mark, the six dots and the number pad, and Face ID offered first once it is
// on. It is drawn INSTEAD of the app, never over it, so nothing of the account is behind it; the lock itself is the
// BFF's (suite B61.25), so the passcode and the Face ID signature are checked there and a copied session opens nothing.
// B57.185 — laid out as Pocket Live draws it: the mark and the words at the top, the dots under them, the number pad at
// the foot with the two ways out under it, small, over the full background.

const W = DOOR_WORDS.lock

const icon = require('../../assets/logo/app-icon-120.png')

export function LockScreen() {
  const { unlock, unlockFaceID, signOut } = useSession()
  const { c } = useTheme()
  const [face, setFace] = useState(false)
  const [said, setSaid] = useState('')
  const [waitUntil, setWaitUntil] = useState(0)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [tries, setTries] = useState(0)
  const asked = useRef(false)

  const tryFace = useCallback(async () => {
    setBusy(true)
    setSaid('')
    try {
      await unlockFaceID()
    } catch (err) {
      // A Face ID that did not pass says nothing: the passcode is right there. Only the BFF's refusal is worded.
      if (err instanceof BffError) setSaid(doorRefusal(err))
      setFace(await faceIDUnlocks())
    } finally {
      setBusy(false)
    }
  }, [unlockFaceID])

  // Face ID first, once, as the lock opens.
  useEffect(() => {
    void faceIDUnlocks().then((on) => {
      setFace(on)
      if (on && !asked.current) {
        asked.current = true
        void tryFace()
      }
    })
  }, [tryFace])

  // The wait after too many wrong passcodes: the pad is off until it ends.
  useEffect(() => {
    if (!waitUntil) return
    const t = setTimeout(() => {
      setWaitUntil(0)
      setSaid('')
    }, Math.max(0, waitUntil - Date.now()))
    return () => clearTimeout(t)
  }, [waitUntil])

  const typed = async (digits: string) => {
    setBusy(true)
    setSaid('')
    try {
      await unlock(digits)
    } catch (err) {
      setSaid(doorRefusal(err))
      const left = waitLeft(err)
      if (left) setWaitUntil(Date.now() + left)
      setTries((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  if (forgot)
    return (
      <Screen footer={<Button variant="ghost" label={DOOR_WORDS.forgot.back} onPress={() => setForgot(false)} />}>
        <View style={{ height: 24 }} />
        <Headline>{DOOR_WORDS.forgot.title}</Headline>
        <Body muted>{DOOR_WORDS.forgot.line}</Body>
        <Button primary label={DOOR_WORDS.forgot.write} onPress={() => void openHelpMail(DOOR_WORDS.forgot.mail)} />
      </Screen>
    )

  return (
    <Screen backdrop="full" fill>
      <View testID="lock-screen" style={{ flex: 1 }}>
        <View style={{ alignItems: 'center', paddingTop: 48 }}>
          <Image source={icon} style={{ width: 64, height: 64, borderRadius: 16 }} accessibilityLabel="Talyvor" />
          <Text accessibilityRole="header" style={{ marginTop: 14, fontFamily: fonts.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, color: c.ink }}>
            {W.title}
          </Text>
        </View>
        <PasscodePad spread onDone={typed} faceID={face ? () => void tryFace() : undefined} disabled={busy || waitUntil > 0} reset={tries}>
          <Text accessibilityLiveRegion="polite" style={{ minHeight: 40, marginTop: 6, textAlign: 'center', fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: c.critical }}>
            {said}
          </Text>
        </PasscodePad>
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <Button variant="ghost" small label={W.forgot} onPress={() => setForgot(true)} />
          <Button variant="ghost" small label={W.signup} onPress={() => void signOut()} />
        </View>
      </View>
    </Screen>
  )
}

/** B61.27 — what the app switcher shows while the app is not in front: the mark on the page, never the screen. */
export function Cover() {
  const { c } = useTheme()
  return (
    <View testID="app-cover" style={[StyleSheet.absoluteFill, { backgroundColor: c.page, alignItems: 'center', justifyContent: 'center' }]}>
      <Image source={icon} style={{ width: 64, height: 64, borderRadius: 16 }} accessibilityLabel="Talyvor" />
    </View>
  )
}

/** B50.57 — iOS draws a sheet above the app, so the Cover in the app sits under it: every sheet draws this inside
 * itself too, over whatever it shows while the app is not in front. The sheet stays up, so what was typed is kept. */
export function SheetCover() {
  const [away, setAway] = useState(AppState.currentState === 'background' || AppState.currentState === 'inactive')
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAway(s !== 'active'))
    return () => sub.remove()
  }, [])
  return away ? <Cover /> : null
}
