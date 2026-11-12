import { formatLXC } from '@talyvor/bff-client'
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'

import { PendingApprovals, decidedWords } from '@/components/approval-card'
import { KeyEnrolmentCards } from '@/components/key-enrolment-cards'
import { PhoneKeyCard } from '@/components/phone-key-card'
import { PreparedPaymentCard, pendingPrepared } from '@/components/prepared-payment-card'
import { Body, Card, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { setWaiting } from '@/waiting'

/** Every approval: payments prepared for you and agents' requests waiting first, then what was decided. */
export default function Approvals() {
  const { client, peg } = useSession()
  const load = useCallback(async () => {
    const [book, approvals, prepared] = await Promise.all([client.book(), client.approvals(), pendingPrepared(client)])
    return { agents: book.agents ?? [], allPaused: !!book.all_paused_at, approvals: approvals.approvals ?? [], prepared }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const [keysWaiting, setKeysWaiting] = useState(0)
  const nameOf = (id: string) => data?.agents.find((a) => a.id === id)?.name ?? id
  const pending = (data?.approvals ?? []).filter((a) => a.status === 'pending')
  const decided = (data?.approvals ?? []).filter((a) => a.status !== 'pending')
  useEffect(() => {
    if (data) setWaiting(pending.length + data.prepared.length)
  }, [data, pending.length])

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Approvals</Eyebrow>
      <Headline>What your agents asked for</Headline>
      <LoadState loading={loading && !data} error={error} />
      <KeyEnrolmentCards onWaiting={setKeysWaiting} />
      {data && pending.length === 0 && data.prepared.length === 0 && !keysWaiting ? <Body muted>Nothing is waiting for you.</Body> : null}
      {data?.prepared.map((r) => (
        <PreparedPaymentCard key={r.id} request={r} />
      ))}
      {data ? <PendingApprovals pending={pending} agents={data.agents} allPaused={data.allPaused} onDecided={reload} /> : null}
      {decided.length ? <Eyebrow>Decided</Eyebrow> : null}
      {decided.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Body style={{ flex: 1 }}>{nameOf(a.agent_id)}</Body>
            <Figure>{formatLXC(a.amount_ulxc, peg)}</Figure>
          </View>
          <Body muted>
            {decidedWords(a)} · {new Date(a.decided_at ?? a.created_at).toLocaleDateString()}
          </Body>
        </Card>
      ))}
      <PhoneKeyCard />
    </Screen>
  )
}
