import { BffError, formatMinor } from '@talyvor/bff-client'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect } from 'react'
import { Text } from 'react-native'

import { Body, Button, Card, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { biometricName } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B40.17 — where "What's due in Talyvor" and "Pay my bills in Talyvor" land: the payments prepared for the person's
// approval. Nothing is paid here; "Pay my bills" with one request waiting goes straight to its approval card.

const payWord = (n: number) => (n === 1 ? '1 payment' : `${n} payments`)

export default function Bills() {
  const { pay } = useLocalSearchParams<{ pay?: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => ((await client.pendingPaymentRequests()).requests ?? []).filter((r) => r.status === 'pending_approval'), [client])
  const { data, error, loading, reload } = useLoad(load)
  const unlisted = error instanceof BffError && (error.status === 404 || error.status === 405)

  useEffect(() => {
    if (pay === '1' && data?.length === 1) router.replace({ pathname: '/approve/[id]', params: { id: data[0].id } })
  }, [pay, data])

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Bills due</Eyebrow>
      <Headline>{data?.length ? `${payWord(data.reduce((n, r) => n + r.items.length, 0))} waiting for you` : 'What is due'}</Headline>
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: c.caution }}>Preview — test money only</Text>
      {unlisted ? (
        <Body muted>Bills due cannot be listed here yet. Each payment prepared for you arrives as a notification that opens its approval card.</Body>
      ) : (
        <LoadState loading={loading && !data} error={error} />
      )}
      {data && data.length === 0 ? <Body muted>No bills are waiting for your approval.</Body> : null}
      {data?.map((r) => (
        <Card key={r.id}>
          <Body>{r.summary || payWord(r.items.length)}</Body>
          <Figure>
            {Object.entries(r.totals)
              .map(([cur, minor]) => formatMinor(minor, cur))
              .join(' + ')}
          </Figure>
          <Body muted>
            {r.items.map((it) => it.payee_name).join(', ')} · {new Date(r.created_at).toLocaleDateString()}
          </Body>
          <Button primary label={`Review and approve with ${biometricName}`} onPress={() => router.push({ pathname: '/approve/[id]', params: { id: r.id } })} />
        </Card>
      ))}
    </Screen>
  )
}
