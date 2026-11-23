import { BffError } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { FieldError } from '@/components/country-field'
import { DoorTop } from '@/components/door'
import { Tick } from '@/components/live'
import { PasscodePad } from '@/components/passcode-pad'
import { Body, Button, Headline, Screen } from '@/components/ui'
import { DOOR_WORDS, doorRefusal, waitLeft } from '@/door-words'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.109 — /settings/passcode, Settings, Security's "Change passcode" (Pocket Live `sub:security`): the old passcode,
// then the new one typed twice, on the number pad, through the BFF (suite B61.105). Lens checks the old one, with its
// wrong tries and its wait, and says why a new one is refused; the phone keeps none of them.
// B57.207 — drawn as Pocket Live's pad pages (`su2`): the door's top bar, the chevron and the Sandbox label, over the
// words, the dots and the pad; changed, Pocket Live's `done`: the tick and its line, with Done at the foot.

type Stage = 'old' | 'choose' | 'again' | 'done'

const toSecurity = () => (router.canGoBack() ? router.back() : router.replace('/settings'))

export default function ChangePasscodeScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const [stage, setStage] = useState<Stage>('old')
  const [old, setOld] = useState('')
  const [chosen, setChosen] = useState('')
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [round, setRound] = useState(0)

  const go = (s: Stage, line = '') => {
    setSaid(line)
    setStage(s)
  }
  const change = async (passcode: string) => {
    if (passcode !== chosen) return go('choose', DOOR_WORDS.again.differ)
    setBusy(true)
    try {
      await client.passcodeChange(old, passcode)
      go('done')
    } catch (err) {
      // A passcode too easy to guess is chosen again; anything else, a wrong old one first, asks for the old one again.
      go(err instanceof BffError && err.code === 'weak_passcode' ? 'choose' : 'old', doorRefusal(err))
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

  if (stage === 'done')
    return (
      <Screen fill footer={<Button primary label="Done" onPress={toSecurity} />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Tick size={84} />
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 36, marginTop: 8, color: c.ink }}>
            {DOOR_WORDS.change.title}
          </Text>
          <Text style={{ maxWidth: 300, textAlign: 'center', fontFamily: fonts.ui, fontSize: 15, lineHeight: 22, color: c.ink2 }}>{DOOR_WORDS.change.done}</Text>
        </View>
      </Screen>
    )

  const [title, line, onDone] =
    stage === 'old'
      ? [DOOR_WORDS.change.old, null, (p: string) => {
          setOld(p)
          go('choose')
        }]
      : stage === 'choose'
        ? [DOOR_WORDS.forgot.choose, DOOR_WORDS.choose.line, (p: string) => {
            setChosen(p)
            go('again')
          }]
        : [DOOR_WORDS.again.title, DOOR_WORDS.again.line, change]
  return (
    <Screen fill>
      <DoorTop onBack={busy ? undefined : stage === 'old' ? toSecurity : () => go(stage === 'again' ? 'choose' : 'old')} />
      <Headline>{title}</Headline>
      {line ? <Body muted>{line}</Body> : null}
      <PasscodePad spread onDone={onDone} disabled={busy || waiting} reset={`${stage}-${round}`}>
        {said ? <FieldError>{said}</FieldError> : null}
      </PasscodePad>
    </Screen>
  )
}
