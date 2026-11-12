import { useState } from 'react'

import { CardTitle, Choices, MessageBox, SaidLine, SentList, useRequests, useSend } from '@/components/account-requests'
import { Back, Body, Button, Card, Headline, Screen } from '@/components/ui'

// B59.29 — /settings/help, the web's Help and complaints (suite B59.28): ask for help or make a complaint, and what was
// sent. A complaint shows its reference as soon as it is sent.

export default function HelpScreen() {
  const requests = useRequests()
  const [kind, setKind] = useState<'support' | 'complaint'>('support')
  const [message, setMessage] = useState('')
  const sent = () => {
    setMessage('')
    requests.reload()
  }
  const help = useSend(() => ({ title: 'Sent', line: 'A person at Talyvor reads it and answers on this page.' }), sent)
  const complaint = useSend((r) => ({ title: 'Complaint received', line: `Its reference is ${r.reference}.` }), sent)
  const send = kind === 'support' ? help : complaint
  const empty = message.trim() === ''

  return (
    <Screen onRefresh={requests.reload} refreshing={requests.loading && !!requests.data}>
      <Back home="/settings" />
      <Headline>Help and complaints</Headline>
      <Body muted>Ask us about your account, or tell us what went wrong. A person at Talyvor reads every message and answers on this page.</Body>
      <Body muted>A complaint gets a reference as soon as you send it. Quote it whenever you write to us about it.</Body>
      <Card>
        <CardTitle>Write to us</CardTitle>
        <Choices
          label="What is it?"
          options={[
            ['support', 'A question or a problem'],
            ['complaint', 'A complaint'],
          ]}
          value={kind}
          onChange={(k) => {
            help.clear()
            complaint.clear()
            setKind(k)
          }}
        />
        <MessageBox label="Your message" value={message} onChange={setMessage} />
        <SaidLine said={send.said} />
        <Button
          primary
          label={send.sending ? 'Sending…' : kind === 'complaint' ? 'Send complaint' : 'Send'}
          disabled={send.sending || empty}
          hint={empty ? 'Write your message first.' : undefined}
          onPress={() => void send.send(kind, message)}
        />
      </Card>
      <SentList requests={requests} kinds={['support', 'complaint']} title="What you sent" empty="Nothing sent yet." />
    </Screen>
  )
}
