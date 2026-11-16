import { HelpLimitError, type HelpMessage } from '@talyvor/bff-client'
import { router, useLocalSearchParams } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Animated, Pressable, Text, TextInput, View } from 'react-native'

import { useAccount } from '@/account'
import { HOME_MONEY } from '@/components/home'
import { Icon } from '@/components/icon'
import { MoneyLabel } from '@/components/money-label'
import { Press } from '@/components/press'
import { Body, Button, Screen, useLoad } from '@/components/ui'
import { HELP_BY, HELP_PAGES, HELP_SUGGESTED, HELP_WORDS as W, helpGreeting, openHelpMail } from '@/help-words'
import { workspaceName } from '@/keys'
import { useReduceMotion } from '@/motion'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.39 — /help, the web's Help chat (suite B61.38) on the phone's own screen, through the same BFF routes
// (/api/help/chat, /ask, /team). Answers are written by AI from Talyvor's own help pages; when it does not know, or the
// question is one our team answers, the reply offers "Send it to our team", which files the chat so far in the help
// inbox and opens the phone's mail app to Talyvor with the question filled in. Each line says who wrote it, so a person
// on our team can answer in the same chat.
// B57.177 — as Pocket Live's phone `help` draws it, in the web's words (suite B57.175): the back arrow, Help in the
// middle and the Sandbox label, then that answers are written by AI; Help's greeting and the chat as bubbles, the person's in ink on the right and Help's in
// cloud on the left; the three questions while nothing is asked; three dots while an answer is written; and at the foot
// "Send it to our team" above a round box with the chat mark and a round Ask arrow.

/** A line of the chat as a bubble, its tail corner on its own side (Pocket Live's .bub). */
function Bubble({ mine, children }: { mine?: boolean; children: ReactNode }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        maxWidth: '82%',
        alignSelf: mine ? 'flex-end' : 'flex-start',
        backgroundColor: mine ? c.primary : c.cloud,
        borderRadius: 20,
        [mine ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: 6,
        paddingHorizontal: 14,
        paddingVertical: 11,
      }}>
      {children}
    </View>
  )
}

function Said({ mine, children }: { mine?: boolean; children: string }) {
  const { c } = useTheme()
  return <Text style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 21, color: mine ? c.onPrimary : c.ink }}>{children}</Text>
}

function Line({ m }: { m: HelpMessage }) {
  const { c } = useTheme()
  const mine = m.by === 'you'
  const page = m.page ? HELP_PAGES[m.page] : undefined
  return (
    <View style={{ gap: 4 }}>
      {/* Who wrote it: said aloud for every line, and shown for our team's, which is a person and not the AI. */}
      <View testID={`help-${m.by}`} accessible accessibilityLabel={`${HELP_BY[m.by]}: ${m.text}`} style={{ gap: 4 }}>
        {m.by === 'team' ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: c.ink2 }}>{HELP_BY.team}</Text> : null}
        <Bubble mine={mine}>
          <Said mine={mine}>{m.text}</Said>
        </Bubble>
      </View>
      {page ? (
        <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.push(page.to)} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, textDecorationLine: 'underline' }}>Open {page.name}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** Three dots that bob while Help writes, and stay still with Reduce Motion on (Pocket Live's .typing). */
function Writing() {
  const { c } = useTheme()
  const reduce = useReduceMotion()
  const [bob] = useState(() => [0, 1, 2].map(() => new Animated.Value(0)))
  useEffect(() => {
    if (reduce) return
    const loop = Animated.loop(
      Animated.stagger(
        150,
        bob.map((v) => Animated.sequence([Animated.timing(v, { toValue: 1, duration: 270, useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: 630, useNativeDriver: true })])),
      ),
    )
    loop.start()
    return () => loop.stop()
  }, [bob, reduce])
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={W.writing} style={{ alignSelf: 'flex-start' }}>
      <Bubble>
        <View style={{ flexDirection: 'row', gap: 4, paddingVertical: 4 }}>
          {bob.map((v, i) => (
            <Animated.View
              key={i}
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: c.ink3,
                opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }),
                transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
              }}
            />
          ))}
        </View>
      </Bubble>
    </View>
  )
}

export default function HelpChatScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const { account } = useAccount(client)
  const { from } = useLocalSearchParams<{ from?: string }>()
  // The page Help was opened from, as the BFF hears it: one of the app's own pages, never what a link said.
  const page = typeof from === 'string' && from in HELP_PAGES ? from : '/settings'
  const load = useCallback(() => client.helpChat(), [client])
  const chat = useLoad(load)
  const [name, setName] = useState('')
  useEffect(() => {
    let live = true
    void workspaceName(client).then((n) => live && setName(n))
    return () => {
      live = false
    }
  }, [client])
  // A person is greeted by their first name; a company's workspace name is not a person's.
  const firstName = account?.account_type === 'personal' ? (name.trim().split(/\s+/)[0] ?? '') : ''
  const [messages, setMessages] = useState<HelpMessage[] | null>(null)
  const shown = messages ?? chat.data ?? []
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)
  const [limit, setLimit] = useState('')
  const [sending, setSending] = useState(false)
  const [notSent, setNotSent] = useState(false)
  const [sent, setSent] = useState(false)

  const ask = async (q: string) => {
    const text = q.trim()
    if (text === '' || asking) return
    setAsking(true)
    setFailed(false)
    setLimit('')
    setSent(false)
    setNotSent(false)
    try {
      setMessages(await client.askHelp(text, page))
      setQuestion('')
    } catch (err) {
      if (err instanceof HelpLimitError) {
        setMessages(err.messages)
        setLimit(err.sentence)
        setQuestion('')
      } else setFailed(true)
    } finally {
      setAsking(false)
    }
  }

  const asked = [...shown].reverse().find((m) => m.by === 'you')?.text ?? ''
  const toTeam = async () => {
    setSending(true)
    setNotSent(false)
    try {
      await client.sendHelpToTeam()
      setSent(true)
      void openHelpMail(asked)
    } catch {
      setNotSent(true)
    } finally {
      setSending(false)
    }
  }

  const last = shown[shown.length - 1]
  const offerTeam = !sent && (limit !== '' || (last?.by === 'ai' && last.team === true && last.topic !== 'complaint'))
  const offerComplaint = !sent && last?.by === 'ai' && last.topic === 'complaint'
  const empty = question.trim() === ''
  const cantAsk = asking || empty

  const footer = (
    <View style={{ gap: 8 }}>
      {sent ? null : offerTeam ? (
        <View style={{ alignItems: 'center' }}>
          <Button primary small label={sending ? W.sending : W.team} disabled={sending} onPress={() => void toTeam()} />
        </View>
      ) : (
        <Press
          accessibilityRole="button"
          accessibilityState={{ disabled: asked === '' || sending }}
          accessibilityHint={asked === '' ? W.askFirst : undefined}
          disabled={asked === '' || sending}
          hitSlop={4}
          onPress={() => void toTeam()}
          style={{ height: 40, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: 14, opacity: asked === '' || sending ? 0.5 : 1 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{sending ? W.sending : W.team}</Text>
        </Press>
      )}
      {notSent ? (
        <Text accessibilityRole="alert" style={{ fontFamily: fonts.ui, fontSize: 15, color: c.danger, textAlign: 'center' }}>
          {W.notSent}
        </Text>
      ) : null}
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 52, borderRadius: 999, borderWidth: 1.5, borderColor: c.control, backgroundColor: c.page, paddingLeft: 16, paddingRight: 2 }}>
        <Icon name="help" color={c.ink2} />
        <TextInput
          accessibilityLabel={W.question}
          placeholder={W.placeholder}
          placeholderTextColor={c.ink3}
          maxLength={4000}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => void ask(question)}
          returnKeyType="send"
          autoComplete="off"
          style={{ flex: 1, height: '100%', fontFamily: fonts.ui, fontSize: 16, color: c.ink }}
        />
        <Press
          kind="round"
          accessibilityRole="button"
          accessibilityLabel={W.ask}
          accessibilityState={{ disabled: cantAsk }}
          accessibilityHint={empty ? W.writeFirst : undefined}
          disabled={cantAsk}
          onPress={() => void ask(question)}
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, opacity: cantAsk ? 0.5 : 1 }}>
          <Icon name="arrowUp" size={16} color={c.onPrimary} />
        </Press>
      </View>
    </View>
  )

  return (
    <Screen onRefresh={chat.reload} refreshing={chat.loading && !!chat.data} footer={footer} toEnd>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Press
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={6}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
            style={{ width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="back" size={22} color={c.ink} />
          </Press>
        </View>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 18, color: c.ink }}>
          {W.title}
        </Text>
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <MoneyLabel capability={HOME_MONEY} />
        </View>
      </View>
      <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink2, textAlign: 'center', marginTop: -8 }}>{W.ai}</Text>
      <View accessibilityLabel="The chat" style={{ gap: 10, paddingTop: 6 }}>
        <View testID="help-hello">
          <Bubble>
            <Said>{helpGreeting(firstName)}</Said>
          </Bubble>
        </View>
        {shown.map((m, i) => (
          <Line key={`${m.at}-${i}`} m={m} />
        ))}
        {asking ? <Writing /> : null}
      </View>
      {chat.error && !messages ? <Body muted>{W.unread}</Body> : null}
      {asked === '' && !asking && !chat.loading ? (
        <View style={{ gap: 8 }}>
          {HELP_SUGGESTED.map((q) => (
            <Press
              key={q}
              accessibilityRole="button"
              accessibilityLabel={q}
              onPress={() => void ask(q)}
              style={{ height: 40, borderRadius: 999, backgroundColor: c.cloud2, justifyContent: 'center', paddingHorizontal: 14 }}>
              <Text style={{ fontFamily: fonts.uiMedium, fontSize: 14, color: c.ink2 }}>{q}</Text>
            </Press>
          ))}
        </View>
      ) : null}
      {limit ? <Text accessibilityRole="alert" style={{ fontFamily: fonts.ui, fontSize: 15, color: c.ink }}>{limit}</Text> : null}
      {failed ? <Text accessibilityRole="alert" style={{ fontFamily: fonts.ui, fontSize: 15, color: c.danger }}>{W.failed}</Text> : null}
      {offerTeam ? <Body muted>{W.byEmail}</Body> : null}
      {offerComplaint ? <Button variant="secondary" label={W.complaint} onPress={() => router.push({ pathname: '/settings/help', params: { kind: 'complaint' } })} /> : null}
      {sent ? (
        <View accessibilityRole="summary" style={{ gap: 4 }}>
          <Body muted>{W.sent}</Body>
          <Pressable accessibilityRole="link" hitSlop={6} onPress={() => void openHelpMail(asked)}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, textDecorationLine: 'underline' }}>{W.again}</Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  )
}
