import { useState } from 'react'

import { CardTitle, MessageBox, SaidLine, SentList, useRequests, useSend } from '@/components/account-requests'
import { Back, Body, Button, Card, Headline, Screen } from '@/components/ui'

// B59.29 — /settings/close, the web's Close this account (suite B59.28): what must be empty first, and the request to
// close. Lens refuses it while any balance is not empty, and the refusal names each one.

export default function CloseAccountScreen() {
  const requests = useRequests()
  const [message, setMessage] = useState('')
  const close = useSend(
    () => ({ title: 'Asked', line: 'A person at Talyvor closes the account and answers on this page.' }),
    () => {
      setMessage('')
      requests.reload()
    },
  )

  return (
    <Screen onRefresh={requests.reload} refreshing={requests.loading && !!requests.data}>
      <Back home="/settings" />
      <Headline>Close this account</Headline>
      <Body muted>Before the account can close, every balance must be empty: the account’s own, each agent’s, and any money set aside. Move the money out first.</Body>
      <Body muted>A person at Talyvor closes the account and answers on this page. Only the account’s owner can ask.</Body>
      <Card>
        <CardTitle>Ask to close</CardTitle>
        <MessageBox label="Anything we should know (optional)" value={message} onChange={setMessage} />
        <SaidLine said={close.said} />
        <Button variant="danger" label={close.sending ? 'Sending…' : 'Ask to close this account'} disabled={close.sending} onPress={() => void close.send('account_closure', message)} />
      </Card>
      <SentList requests={requests} kinds={['account_closure']} title="What you asked" empty="You have not asked to close this account." />
    </Screen>
  )
}
