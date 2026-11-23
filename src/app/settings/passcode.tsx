import { BffError } from '@talyvor/bff-client'
import { useState } from 'react'

import { FieldError } from '@/components/country-field'
import { PasscodePad } from '@/components/passcode-pad'
import { Back, Body, Headline, Screen } from '@/components/ui'
import { DOOR_WORDS, doorRefusal, waitLeft } from '@/door-words'
import { useSession } from '@/session'

// B61.109 — /settings/passcode, Settings, Security's "Change passcode" (Pocket Live `sub:security`): the old passcode,
// then the new one typed twice, on the number pad, through the BFF (suite B61.105). Lens checks the old one, with its
// wrong tries and its wait, and says why a new one is refused; the phone keeps none of them.

type Stage = 'old' | 'choose' | 'again' | 'done'

export default function ChangePasscodeScreen() {
  const { client } = useSession()
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
      <Screen>
        <Back home="/settings" />
        <Headline>{DOOR_WORDS.change.title}</Headline>
        <Body muted>{DOOR_WORDS.change.done}</Body>
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
      <Back home="/settings" />
      <Headline>{title}</Headline>
      {line ? <Body muted>{line}</Body> : null}
      <PasscodePad spread onDone={onDone} disabled={busy || waiting} reset={`${stage}-${round}`}>
        {said ? <FieldError>{said}</FieldError> : null}
      </PasscodePad>
    </Screen>
  )
}
