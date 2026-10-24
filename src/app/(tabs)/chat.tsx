import { BffError, formatMinor, refusalText, type OutsidePayee, type PaymentRequest } from '@talyvor/bff-client'
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio'
import * as Crypto from 'expo-crypto'
import { router } from 'expo-router'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { AppState, Pressable, Switch, Text, TextInput, View } from 'react-native'

import { bareAmount, currencyOf, parsePay, payeesCalled, PAUSE_ALL, RESUME_ALL, type Amount, type PayAsk } from '@/chat-commands'
import { Body, Button, Card, Eyebrow, Headline, Screen } from '@/components/ui'
import { biometricName } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'
import { AI_NOTICE, heyTalyAvailable, listenForHeyTaly, notToldYet, sayAloud } from '@/voice'

// B40.16 — Chat on the phone: typed, held-to-talk, or after "Hey Taly" while the app is open. "Pause all agents" asks
// first; "pay the ACME invoice" is prepared with Lens, read back, and paid only once the person approves it with Face ID
// on the approval card. Anything else is asked of the model, as on the web.

type Confirm = 'pause-all' | 'resume-all'

interface Turn {
  id: number
  from: 'you' | 'taly'
  text: string
  /** said rather than typed: the answer is spoken too */
  voiced?: boolean
  confirm?: Confirm
  /** a prepared payment request, opened on its approval card */
  approve?: string
  settled?: boolean
}

const CONFIRM: Record<Confirm, { said: string; yes: string; done: string }> = {
  'pause-all': {
    said: 'Pause every agent? Lens refuses each one’s next request or payment until you start them again.',
    yes: 'Yes, pause all',
    done: 'Every agent is paused.',
  },
  'resume-all': { said: 'Start every agent again? An agent you paused on its own stays paused.', yes: 'Yes, start all', done: 'Your agents can work again.' },
}

/** How long a "Hey Taly" listens before it sends what it heard. shortcut: a fixed window, not silence detection. */
const WAKE_LISTEN_MS = 6000

/** The read-back: the payee and the amount, and that nothing is paid yet. Account numbers are never said. */
function readBack(r: PaymentRequest): string {
  const it = r.items[0]
  if (it === undefined) return 'Nothing was prepared.'
  const what = `${formatMinor(it.amount_minor, it.currency)} to ${it.payee_name}`
  return it.decision === 'blocked'
    ? `The payment of ${what} can’t be made: ${it.reason}.`
    : `I’ve prepared a payment of ${what}. Nothing is paid until you approve it with ${biometricName}.`
}

const why = (err: unknown) => (err instanceof BffError && err.status < 500 ? refusalText(err) : 'No answer just now. You can try again.')

export default function ChatScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const [turns, setTurns] = useState<Turn[]>([])
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [heyTaly, setHeyTaly] = useState(false)
  const [active, setActive] = useState(AppState.currentState !== 'background')
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const seq = useRef(0)
  const said = useRef<Turn[]>([])
  /** a payment waiting for "how much?" */
  const owed = useRef<{ ask: PayAsk; payee: OutsidePayee } | null>(null)
  const starting = useRef<Promise<boolean> | null>(null)
  const noticed = useRef(false)

  const add = (t: Omit<Turn, 'id'>) => {
    const turn = { ...t, id: ++seq.current }
    said.current = [...said.current, turn]
    setTurns(said.current)
  }
  const reply = (t: Omit<Turn, 'id' | 'from'>) => {
    add({ ...t, from: 'taly' })
    if (t.voiced) sayAloud(client, t.text).catch(() => undefined)
  }

  const prepare = async (to: { ask: PayAsk; payee: OutsidePayee }, much: Amount, voiced: boolean) => {
    const item = { payee_id: to.payee.id, currency: much.currency ?? currencyOf(to.payee), amount_minor: much.minor, reference: to.ask.reference }
    const r = await client.preparePayment(voiced, [item], Crypto.randomUUID())
    reply({ text: readBack(r), voiced, approve: r.status === 'pending_approval' ? r.id : undefined })
  }

  /** One thing the person said or typed: a command Chat answers itself, or a question for the model. */
  const answer = async (text: string, voiced: boolean) => {
    setBusy(true)
    try {
      const waiting = owed.current
      owed.current = null
      const much = waiting ? bareAmount(text) : null
      if (waiting && much) return await prepare(waiting, much, voiced)
      if (PAUSE_ALL.test(text)) return reply({ text: CONFIRM['pause-all'].said, voiced, confirm: 'pause-all' })
      if (RESUME_ALL.test(text)) return reply({ text: CONFIRM['resume-all'].said, voiced, confirm: 'resume-all' })
      const ask = parsePay(text)
      if (ask) {
        const matches = payeesCalled((await client.payees()).payees ?? [], ask.payee)
        if (matches.length === 0) return reply({ text: `No saved payee is called “${ask.payee}”. Chat pays only payees you saved yourself.`, voiced })
        if (matches.length > 1) return reply({ text: `More than one saved payee is called “${ask.payee}”: ${matches.map((p) => p.name).join(', ')}. Say the full name.`, voiced })
        if (!ask.amount) {
          owed.current = { ask, payee: matches[0] }
          return reply({ text: `How much should I pay ${matches[0].name}?`, voiced })
        }
        return await prepare({ ask, payee: matches[0] }, ask.amount, voiced)
      }
      const history = said.current.map((t) => ({ role: t.from === 'you' ? ('user' as const) : ('assistant' as const), content: t.text }))
      reply({ text: (await client.ask(history)) || 'No answer came back. You can try again.', voiced })
    } catch (err) {
      reply({ text: why(err), voiced })
    } finally {
      setBusy(false)
    }
  }

  const send = () => {
    const text = typed.trim()
    if (text === '' || busy) return
    setTyped('')
    add({ from: 'you', text })
    void answer(text, false)
  }

  const decide = async (turn: Turn) => {
    setTurns((said.current = said.current.map((t) => (t.id === turn.id ? { ...t, settled: true } : t))))
    try {
      if (turn.confirm === 'pause-all') await client.pauseAll('Paused from Chat')
      else await client.resumeAll()
      reply({ text: CONFIRM[turn.confirm!].done, voiced: turn.voiced })
    } catch (err) {
      reply({ text: refusalText(err), voiced: turn.voiced })
    }
  }

  const listen = (byWake: boolean) => {
    if (starting.current) return
    starting.current = (async () => {
      if (!(await requestRecordingPermissionsAsync()).granted) {
        add({ from: 'taly', text: 'Talyvor may not use the microphone. Allow it in Settings to talk.' })
        return false
      }
      if (!noticed.current && (await notToldYet())) add({ from: 'taly', text: AI_NOTICE })
      noticed.current = true
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setListening(true)
      return true
    })()
    if (byWake) setTimeout(() => void finish(), WAKE_LISTEN_MS)
  }

  const finish = async () => {
    const started = starting.current
    starting.current = null
    if (!started || !(await started.catch(() => false))) return
    await recorder.stop()
    setListening(false)
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    if (!recorder.uri) return
    const form = new FormData()
    // React Native's FormData sends a file by its address on the phone.
    form.append('file', { uri: recorder.uri, name: 'speech.m4a', type: 'audio/mp4' } as unknown as Blob)
    try {
      const text = await client.transcribe(form)
      if (text === '') return add({ from: 'taly', text: 'I didn’t hear anything. Hold the microphone and try again.' })
      add({ from: 'you', text, voiced: true })
      await answer(text, true)
    } catch (err) {
      add({ from: 'taly', text: why(err) })
    }
  }

  const heard = useEffectEvent(() => {
    router.navigate('/chat')
    listen(true)
  })
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s !== 'background'))
    return () => sub.remove()
  }, [])
  // "Hey Taly" listens only while the switch is on, the app is open and nothing else is using the microphone.
  useEffect(() => {
    if (!heyTaly || !active || listening) return
    let stopped = false
    const off = async () => {
      if (stopped) return
      stopped = true
      await (await engine)?.()
    }
    const engine = listenForHeyTaly(() => {
      void off().then(heard)
    }).catch(() => {
      setHeyTaly(false)
      add({ from: 'taly', text: '“Hey Taly” could not start listening. You can still hold the microphone to talk.' })
      return null
    })
    return () => void off()
  }, [heyTaly, active, listening])

  const input = { flex: 1, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, color: c.ink, fontSize: 15, fontFamily: fonts.ui }

  return (
    <Screen>
      <Eyebrow>Chat</Eyebrow>
      <Headline>Ask Talyvor</Headline>
      <Body muted>Ask anything, or say “pause all agents” or “pay the ACME invoice”. Nothing is paid until you approve it with {biometricName}.</Body>
      {heyTalyAvailable() ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Body style={{ flex: 1 }}>Listen for “Hey Taly” while the app is open</Body>
          <Switch accessibilityLabel="Listen for Hey Taly" value={heyTaly} onValueChange={setHeyTaly} trackColor={{ true: c.accent, false: c.lineStrong }} />
        </View>
      ) : null}
      {turns.map((t) => (
        <View key={t.id} style={{ alignSelf: t.from === 'you' ? 'flex-end' : 'stretch', maxWidth: t.from === 'you' ? '85%' : '100%' }}>
          {t.from === 'you' ? (
            <View style={{ backgroundColor: c.accentTint, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Body>{t.text}</Body>
            </View>
          ) : (
            <Card>
              <Body>{t.text}</Body>
              {t.confirm && !t.settled ? <Button primary label={CONFIRM[t.confirm].yes} onPress={() => void decide(t)} /> : null}
              {t.approve ? (
                <Button primary label={`Review and approve with ${biometricName}`} onPress={() => router.push({ pathname: '/approve/[id]', params: { id: t.approve! } })} />
              ) : null}
            </Card>
          )}
        </View>
      ))}
      {busy ? <Body muted>Taly is answering…</Body> : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <TextInput
          accessibilityLabel="Message"
          placeholder="Message Talyvor"
          placeholderTextColor={c.inkMuted}
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={send}
          returnKeyType="send"
          style={input}
        />
        <Button label="Send" disabled={busy || typed.trim() === ''} onPress={send} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Listening. Let go to send.' : 'Hold to talk'}
        onPressIn={() => listen(false)}
        onPressOut={() => void finish()}
        style={({ pressed }) => [
          { borderRadius: 999, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
          listening || pressed ? { backgroundColor: c.accent, borderColor: c.accent } : { borderColor: c.lineStrong },
        ]}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: listening ? c.onAccent : c.ink }}>{listening ? 'Listening…' : 'Hold to talk'}</Text>
      </Pressable>
    </Screen>
  )
}
