import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'

import { DecidedApprovals, PendingApprovals } from '@/components/approval-card'
import { KeyEnrolmentCards } from '@/components/key-enrolment-cards'
import { AGENT_CREDIT, MoneyLabel, PAY_OUT, approvalCapability, paymentRequestCapabilities } from '@/components/money-label'
import { PhoneKeyCard } from '@/components/phone-key-card'
import { PreparedPaymentCard, pendingPrepared } from '@/components/prepared-payment-card'
import { Body, Card, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { setWaiting } from '@/waiting'

// B57.68 — the Approvals tab as Pocket draws it (p-approvals): the label, payments prepared for you and agents' requests
// waiting with Review, then what was decided by agent and payee, and this phone's Approve with Face ID.

/** What Approvals moves money on: agents' spending and payments out, and whatever else a request in view moves it on. */
const APPROVALS_MONEY = [...AGENT_CREDIT, ...PAY_OUT]

/** Every approval: payments prepared for you and agents' requests waiting first, then what was decided. */
export default function Approvals() {
  const { client } = useSession()
  const load = useCallback(async () => {
    const [book, approvals, prepared] = await Promise.all([client.book(), client.approvals(), pendingPrepared(client)])
    return { agents: book.agents ?? [], allPaused: !!book.all_paused_at, approvals: approvals.approvals ?? [], prepared }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const [keysWaiting, setKeysWaiting] = useState(0)
  const pending = (data?.approvals ?? []).filter((a) => a.status === 'pending')
  const decided = (data?.approvals ?? []).filter((a) => a.status !== 'pending')
  // One label for the screen, as Pocket draws it: Live only when every capability a row moves money on is live.
  const capabilities = [
    ...new Set([...APPROVALS_MONEY, ...pending.map((a) => approvalCapability(a, data?.agents ?? [])), ...paymentRequestCapabilities(data?.prepared ?? [])]),
  ]
  useEffect(() => {
    if (data) setWaiting(pending.length + data.prepared.length)
  }, [data, pending.length])

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>Approvals</Headline>
        <MoneyLabel capability={capabilities} />
      </View>
      <Body muted>What your agents asked for</Body>
      <LoadState loading={loading && !data} error={error} />
      {data?.prepared.map((r) => (
        <PreparedPaymentCard key={r.id} request={r} label={false} />
      ))}
      {data ? <PendingApprovals pending={pending} agents={data.agents} allPaused={data.allPaused} labels={false} onDecided={reload} /> : null}
      {data && pending.length === 0 && data.prepared.length === 0 && !keysWaiting ? (
        <Card white tight>
          <Body muted>Nothing is waiting for you.</Body>
        </Card>
      ) : null}
      {data ? <DecidedApprovals decided={decided} agents={data.agents} /> : null}
      <KeyEnrolmentCards onWaiting={setKeysWaiting} />
      <PhoneKeyCard />
    </Screen>
  )
}
