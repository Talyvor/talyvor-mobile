import { formatMinor } from '@talyvor/bff-client'
import { Link, useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { View } from 'react-native'

import { Body, Card, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { categoryName, day } from '@/spending'

const DAY = 24 * 60 * 60 * 1000

/** B53.9 — where a spending notice lands (its push carries only the notice's id): the payment it is about. */
export default function NoticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const load = useCallback(async () => {
    const [notices, book] = await Promise.all([client.notices(), client.book()])
    const notice = (notices.notices ?? []).find((n) => n.id === id) ?? null
    const entry = notice?.data?.entry_id
    if (!notice || !entry) return { notice, payment: null, agents: book.agents ?? [] }
    // A notice is written once its payment is read, so the payment is in the month before it.
    const at = new Date(notice.created_at).getTime()
    const spending = await client.spending(new Date(at - 31 * DAY).toISOString(), new Date(at + DAY).toISOString())
    return { notice, payment: (spending.payments ?? []).find((p) => p.entry_id === entry) ?? null, agents: book.agents ?? [] }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const n = data?.notice
  const p = data?.payment
  const whose = !p?.agent_id ? 'Your own wallet' : (data?.agents.find((a) => a.id === p.agent_id)?.name ?? 'An agent')

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>{n?.title ?? 'Payment'}</Eyebrow>
      <Headline>{p ? p.merchant || 'A payment' : (n?.title ?? 'Payment')}</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data && !n ? <Body muted>There is no notice at this address. It may belong to another workspace.</Body> : null}
      {p ? (
        <Card>
          <Figure size={28}>{formatMinor(p.amount_minor, p.currency)}</Figure>
          <View style={{ gap: 2 }}>
            <Body>{categoryName(p.category)}</Body>
            <Body muted>
              {day(p.created_at)} · {new Date(p.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {whose}
            </Body>
          </View>
        </Card>
      ) : null}
      {n ? <Body muted>{n.body}</Body> : null}
      {data && n && !p ? (
        <Link href="/spending">
          <Body>See all your spending</Body>
        </Link>
      ) : null}
    </Screen>
  )
}
