import { useState } from 'react'

import { CardTitle, Lead, MessageBox, SaidLine, SentList, useRequests, useSend } from '@/components/account-requests'
import { Back, Body, Button, Card, Headline, Screen } from '@/components/ui'

// B59.29 — /settings/data, the web's Your data (suite B59.28): ask for a copy of the account's data and, once Talyvor has
// marked it done, hand it to the share sheet; or ask for the data to be deleted. B57.140: what was asked comes before the
// forms, and deleting is said in the privacy notice's words (suite B57.139).

export default function YourDataScreen() {
  const requests = useRequests()
  const [message, setMessage] = useState('')
  const copy = useSend(() => ({ title: 'Asked', line: 'When your copy is ready, Download appears on this page.' }), requests.reload)
  const erase = useSend(
    () => ({ title: 'Asked', line: 'A person at Talyvor answers on this page.' }),
    () => {
      setMessage('')
      requests.reload()
    },
  )

  return (
    <Screen onRefresh={requests.reload} refreshing={requests.loading && !!requests.data}>
      <Back home="/settings" />
      <Headline>Your data</Headline>
      <Lead>A copy of your data, or ask for it to be deleted</Lead>
      <Body muted>Ask for a copy of this account’s data, or ask Talyvor to delete it. A person at Talyvor handles each request. Only the account’s owner can ask.</Body>
      <SentList requests={requests} kinds={['data_export', 'data_deletion']} title="What you asked" empty="You have not asked for your data." />
      <Card>
        <CardTitle>A copy of your data</CardTitle>
        <Body muted>A person at Talyvor prepares it. When it is ready, Download appears beside your request.</Body>
        <SaidLine said={copy.said} />
        <Button primary label={copy.sending ? 'Sending…' : 'Ask for a copy'} disabled={copy.sending} onPress={() => void copy.send('data_export', '')} />
      </Card>
      <Card>
        <CardTitle>Delete your data</CardTitle>
        <Body muted>Ask, and we delete it. Billing and ledger records, statements included, are kept as the law requires.</Body>
        <MessageBox label="Anything we should know (optional)" value={message} onChange={setMessage} />
        <SaidLine said={erase.said} />
        <Button variant="danger" label={erase.sending ? 'Sending…' : 'Ask to delete your data'} disabled={erase.sending} onPress={() => void erase.send('data_deletion', message)} />
      </Card>
    </Screen>
  )
}
