import { formatULXC } from '@talyvor/bff-client'
import { useCallback } from 'react'
import { View } from 'react-native'

import { ApprovalCard } from '@/components/approval-card'
import { PhoneKeyCard } from '@/components/phone-key-card'
import { Body, Card, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

const DECIDED = { approved: 'Approved', denied: 'Denied', used: 'Approved and spent' } as const

/** Every approval: those waiting first, then what was decided. */
export default function Approvals() {
  const { client } = useSession()
  const load = useCallback(async () => {
    const [book, approvals] = await Promise.all([client.book(), client.approvals()])
    return { agents: book.agents ?? [], approvals: approvals.approvals ?? [] }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const nameOf = (id: string) => data?.agents.find((a) => a.id === id)?.name ?? id
  const pending = (data?.approvals ?? []).filter((a) => a.status === 'pending')
  const decided = (data?.approvals ?? []).filter((a) => a.status !== 'pending')

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Approvals</Eyebrow>
      <Headline>What your agents asked for</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data && pending.length === 0 ? <Body muted>Nothing is waiting for you.</Body> : null}
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
            {DECIDED[a.status as keyof typeof DECIDED]} · {new Date(a.created_at).toLocaleDateString()}
          </Body>
        </Card>
      ))}
      <PhoneKeyCard />
    </Screen>
  )
}
