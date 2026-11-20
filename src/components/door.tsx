import { BffError } from '@talyvor/bff-client'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'

import { FieldError } from '@/components/country-field'
import { Icon } from '@/components/icon'
import { MoneyLabel, useMoneyLabels } from '@/components/money-label'
import { PasscodePad } from '@/components/passcode-pad'
import { Body, Button, Headline, Note, Screen } from '@/components/ui'
import { DOOR_WORDS, doorRefusal, waitLeft } from '@/door-words'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.27 — the front door on the phone, as the web's (suite B61.25 and B61.26): the phone number, the texted code
// (filled from the text where the phone offers it), then the passcode for a known number, or a new one chosen twice for
// a new number, which goes on to sign-up's steps. Nothing says whether a number has an account until the code is right.
// B57.185 — drawn as Pocket Live's `su0` to `su2`: the country beside the number in one row, the code's six dots with
// the Sandbox code in a note, and the passcode's dots under the words with the number pad at the foot. The code is
// still typed with the phone's own keyboard under the dots, so the phone can fill it from the text.

type Stage = 'phone' | 'code' | 'enter' | 'choose' | 'again'

function SandboxLabel() {
  const labels = useMoneyLabels()
  return <MoneyLabel capability={Object.keys(labels ?? {})} />
}

function Top({ onBack }: { onBack?: () => void }) {
  const { c, dark } = useTheme()
  return (
    <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ width: 48, height: 48, marginLeft: -14, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <Icon name="chev" color={c.ink} />
          </View>
        </Pressable>
      ) : (
        <Image
          source={dark ? require('../../assets/logo/talyvor-logo-small-on-dark-480.png') : require('../../assets/logo/talyvor-logo-small-on-light-480.png')}
          style={{ width: 132, height: 42 }}
          contentFit="contain"
          accessibilityLabel="Talyvor"
        />
      )}
      <View>
        <SandboxLabel />
      </View>
    </View>
  )
}

export function Door() {
  const { client, signInWithDoor } = useSession()
  const { c } = useTheme()
  const [stage, setStage] = useState<Stage>('phone')
  const [dial, setDial] = useState('+44')
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [sandboxCode, setSandboxCode] = useState('')
  const [check, setCheck] = useState('')
  const [chosen, setChosen] = useState('')
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [round, setRound] = useState(0)

  // Pocket Live's .input: 46 high, round 14, a 1.5 control edge on the page.
  const input = { height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: c.control, backgroundColor: c.page }
  const inputText = { fontFamily: fonts.ui, fontSize: 15, color: c.ink }
  const phone = `${dial.trim()}${number.replace(/[^\d]/g, '')}`
  const go = (s: Stage) => {
    setSaid('')
    setStage(s)
  }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setSaid('')
    try {
      await work()
    } catch (err) {
      setSaid(doorRefusal(err))
      const left = waitLeft(err)
      if (left) {
        setWaiting(true)
        setTimeout(() => setWaiting(false), left)
      }
      setRound((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      const s = await client.phoneStart(phone)
      setSandboxCode(s.sandbox ? (s.sandbox_code ?? '') : '')
      setCode('')
      go('code')
    })

  const typedCode = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6)
      void run(async () => {
        const f = await client.phoneFinish(phone, digits)
        setCheck(f.check)
        go(f.has_person ? 'enter' : 'choose')
      })
  }

  const enter = (passcode: string) =>
    run(async () => {
      await signInWithDoor(await client.phoneSignIn(check, passcode))
    })

  const again = (passcode: string) =>
    run(async () => {
      if (passcode !== chosen) {
        setChosen('')
        go('choose')
        setSaid(DOOR_WORDS.again.differ)
        return
      }
      try {
        await signInWithDoor(await client.phoneJoin(check, passcode), passcode)
      } catch (err) {
        // A passcode Lens finds too easy to guess is chosen again; its words say why.
        if (err instanceof BffError && err.code === 'weak_passcode') {
          setChosen('')
          setStage('choose')
        }
        throw err
      }
      router.replace('/sign-up')
    })

  const error = said ? <FieldError>{said}</FieldError> : null
  const back = busy ? undefined : () => go(stage === 'again' ? 'choose' : stage === 'code' ? 'phone' : 'phone')

  if (stage === 'phone')
    return (
      <Screen
        footer={
          <>
            {error}
            <Button primary label={DOOR_WORDS.phone.go} disabled={busy || number.replace(/\D/g, '').length < 6} onPress={() => void start()} />
          </>
        }>
        <Top />
        <Headline>{DOOR_WORDS.phone.title}</Headline>
        <Body muted>{DOOR_WORDS.phone.line}</Body>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <View style={[input, { width: 96, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 }]}>
            <Icon name="globe" size={16} color={c.ink2} />
            <TextInput
              accessibilityLabel={DOOR_WORDS.phone.code}
              value={dial}
              onChangeText={setDial}
              keyboardType="phone-pad"
              maxLength={5}
              autoComplete="tel-country-code"
              style={[inputText, { flex: 1, minWidth: 0 }]}
            />
          </View>
          <TextInput
            accessibilityLabel={DOOR_WORDS.phone.number}
            value={number}
            onChangeText={setNumber}
            keyboardType="phone-pad"
            autoComplete="tel-national"
            textContentType="telephoneNumber"
            placeholder="7700 900456"
            placeholderTextColor={c.ink3}
            maxLength={20}
            style={[input, inputText, { flex: 1, paddingHorizontal: 14 }]}
          />
        </View>
      </Screen>
    )

  if (stage === 'code')
    return (
      <Screen footer={error}>
        <Top onBack={back} />
        <Headline>{DOOR_WORDS.code.title}</Headline>
        <Body muted>{DOOR_WORDS.code.sentTo(`${dial} ${number.trim()}`)}</Body>
        <View style={{ height: 46, marginTop: 4, justifyContent: 'center' }}>
          <View testID="code-dots" style={{ flexDirection: 'row', gap: 14, justifyContent: 'center' }}>
            {Array.from({ length: 6 }, (_, i) => (
              <View
                key={i}
                style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < code.length ? c.ink : 'transparent', borderWidth: i < code.length ? 0 : 1.5, borderColor: c.control }}
              />
            ))}
          </View>
          {/* The phone's own keyboard types the code under the dots, so the phone can offer it from the text. */}
          <TextInput
            accessibilityLabel={DOOR_WORDS.code.field}
            value={code}
            onChangeText={typedCode}
            editable={!busy}
            autoFocus
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            caretHidden
            style={[StyleSheet.absoluteFill, { opacity: 0.01, color: 'transparent' }]}
          />
        </View>
        {sandboxCode ? <Note icon="help">{DOOR_WORDS.code.sandbox(sandboxCode)}</Note> : null}
      </Screen>
    )

  const pad = (title: string, line: string | null, onDone: (p: string) => Promise<void> | void) => (
    <Screen fill>
      <Top onBack={back} />
      <Headline>{title}</Headline>
      {line ? <Body muted>{line}</Body> : null}
      <PasscodePad spread onDone={onDone} disabled={busy || waiting} reset={`${stage}-${round}`}>
        {error}
      </PasscodePad>
    </Screen>
  )
  if (stage === 'enter') return pad(DOOR_WORDS.enter.title, null, enter)
  if (stage === 'choose')
    return pad(DOOR_WORDS.choose.title, DOOR_WORDS.choose.line, (p) => {
      setChosen(p)
      go('again')
    })
  return pad(DOOR_WORDS.again.title, DOOR_WORDS.again.line, again)
}
