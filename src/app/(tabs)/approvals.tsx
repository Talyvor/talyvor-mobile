import { formatULXC } from '@talyvor/bff-client'
import { useCallback, useState } from 'react'
import { View } from 'react-native'

import { ApprovalCard } from '@/components/approval-card'
import { KeyEnrolmentCards } from '@/components/key-enrolment-cards'
import { PhoneKeyCard } from '@/components/phone-key-card'
import { PreparedPaymentCard, pendingPrepared } from '@/components/prepared-payment-card'
import { Body, Card, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

const DECIDED: Record<string, string> = { approved: 'Approved', denied: 'Denied', used: 'Approved and spent', expired: 'Expired' }

/** Every approval: payments prepared for you and agents' requests waiting first, then what was decided. */
export default function Approvals() {
  const { client } = useSession()
  const load = useCallback(async () => {
    const [book, approvals, prepared] = await Promise.all([client.book(), client.approvals(), pendingPrepared(client)])
    return { agents: book.agents ?? [], approvals: approvals.approvals ?? [], prepared }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const [keysWaiting, setKeysWaiting] = useState(0)
  const nameOf = (id: string) => data?.agents.find((a) => a.id === id)?.name ?? id
  const pending = (data?.approvals ?? []).filter((a) => a.status === 'pending')
  const decided = (data?.approvals ?? []).filter((a) => a.status !== 'pending')

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
      {pending.map((a) => (
        <ApprovalCard key={a.id} approval={a} agentName={nameOf(a.agent_id)} onDecided={reload} />
      ))}
      {decided.length ? <Eyebrow>Decided</Eyebrow> : null}
      {decided.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Body style={{ flex: 1 }}>{nameOf(a.agent_id)}</Body>
            <Figure>{formatULXC(a.amount_ulxc)}</Figure>
          </View>
          <Body muted>
            {DECIDED[a.status] ?? 'Closed'} · {new Date(a.decided_at ?? a.created_at).toLocaleDateString()}
          </Body>
        </Card>
      ))}
      <PhoneKeyCard />
    </Screen>
  )
}
