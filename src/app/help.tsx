import { HelpLimitError, type HelpMessage } from '@talyvor/bff-client'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { Back, Body, Button, Headline, Screen, useLoad } from '@/components/ui'
import { HELP_BY, HELP_PAGES, HELP_SUGGESTED, HELP_WORDS as W, openHelpMail } from '@/help-words'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.39 — /help, the web's Help chat (suite B61.38) on the phone's own screen, through the same BFF routes
// (/api/help/chat, /ask, /team). Answers are written by AI from Talyvor's own help pages; when it does not know, or the
// question is one our team answers, the reply offers "Send to our team", which files the chat so far in the help inbox
// and opens the phone's mail app to Talyvor with the question filled in. Each line says who wrote it, so a person on
// our team can answer in the same chat. Pocket Live's phone `help` sets the order: the chat, the questions to start
// with while it is empty, and the team's button above where a question is written.

function Line({ m }: { m: HelpMessage }) {
  const { c } = useTheme()
  const mine = m.by === 'you'
  const page = m.page ? HELP_PAGES[m.page] : undefined
  return (
    <View testID={`help-${m.by}`} style={{ gap: 4, alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: c.ink3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>{HELP_BY[m.by]}</Text>
      <View style={{ backgroundColor: mine ? c.cloud2 : c.cloud, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }}>
        <Body>{m.text}</Body>
      </View>
      {page ? (
        <Pressable accessibilityRole="link" hitSlop={6} onPress={() => router.push(page.to)}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, textDecorationLine: 'underline' }}>Open {page.name}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export default function HelpChatScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const { from } = useLocalSearchParams<{ from?: string }>()
  // The page Help was opened from, as the BFF hears it: one of the app's own pages, never what a link said.
  const page = typeof from === 'string' && from in HELP_PAGES ? from : '/settings'
  const load = useCallback(() => client.helpChat(), [client])
  const chat = useLoad(load)
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

  const footer = (
    <View style={{ gap: 10 }}>
      {offerTeam ? (
        <View style={{ gap: 6 }}>
          <Body muted>{W.byEmail}</Body>
          <Button primary label={sending ? W.sending : W.team} disabled={sending} onPress={() => void toTeam()} />
          {notSent ? <Text accessibilityRole="alert" style={{ fontFamily: fonts.ui, fontSize: 15, color: c.danger }}>{W.notSent}</Text> : null}
        </View>
      ) : null}
      {offerComplaint ? <Button variant="secondary" label={W.complaint} onPress={() => router.push({ pathname: '/settings/help', params: { kind: 'complaint' } })} /> : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          accessibilityLabel={W.question}
          placeholder={W.placeholder}
          placeholderTextColor={c.ink3}
          maxLength={4000}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => void ask(question)}
          returnKeyType="send"
          style={{ flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1.5, borderColor: c.control, paddingHorizontal: 18, fontFamily: fonts.ui, fontSize: 16, color: c.ink, backgroundColor: c.page }}
        />
        <Button primary small label={W.ask} disabled={asking || empty} hint={empty ? W.writeFirst : undefined} onPress={() => void ask(question)} />
      </View>
    </View>
  )

  return (
    <Screen onRefresh={chat.reload} refreshing={chat.loading && !!chat.data} footer={footer}>
      <Back home="/settings" />
      <Headline>{W.title}</Headline>
      <Body>{W.lead}</Body>
      <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{W.ai}</Text>
      {chat.error && !messages ? <Body muted>{W.unread}</Body> : null}
      <View accessibilityLabel="The chat" style={{ gap: 12 }}>
        {shown.map((m, i) => (
          <Line key={`${m.at}-${i}`} m={m} />
        ))}
      </View>
      {shown.length === 0 && !chat.loading ? (
        <View style={{ gap: 8 }}>
          {HELP_SUGGESTED.map((q) => (
            <Button key={q} variant="secondary" label={q} disabled={asking} onPress={() => void ask(q)} />
          ))}
        </View>
      ) : null}
      {asking ? <Body muted>{W.writing}</Body> : null}
      {limit ? <Text accessibilityRole="alert" style={{ fontFamily: fonts.ui, fontSize: 15, color: c.ink }}>{limit}</Text> : null}
      {failed ? <Text accessibilityRole="alert" style={{ fontFamily: fonts.ui, fontSize: 15, color: c.danger }}>{W.failed}</Text> : null}
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
