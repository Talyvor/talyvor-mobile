import { safeToSpend } from '@talyvor/bff-client'
import { Link } from 'expo-router'
import { useCallback, useEffect } from 'react'
import { Pressable, View } from 'react-native'

import { ApprovalCard } from '@/components/approval-card'
import { Face } from '@/components/face'
import { Icon } from '@/components/icon'
import { AGENT_CREDIT, MoneyHeader, approvalCapability } from '@/components/money-label'
import { Money } from '@/components/money'
import { PreparedPaymentCard, pendingPrepared } from '@/components/prepared-payment-card'
import { Body, Card, Eyebrow, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { useTheme } from '@/theme'
import { setWaiting } from '@/waiting'
import { syncWidget } from '@/widget-sync'

/** Home: what waits for you first, then what you can safely spend, then each agent. */
export default function Home() {
  const { client, peg } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [book, approvals, prepared] = await Promise.all([client.book(), client.approvals(), pendingPrepared(client)])
    return { book, approvals: approvals.approvals ?? [], prepared }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  useEffect(() => {
    if (data) void syncWidget(client, data)
  }, [client, data])
  const agents = (data?.book.agents ?? []).filter((a) => !a.archived_at)
  const pending = (data?.approvals ?? []).filter((a) => a.status === 'pending')
  const waiting = pending.length + (data?.prepared.length ?? 0)
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  useEffect(() => {
    if (data) setWaiting(waiting)
  }, [data, waiting])

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Eyebrow>Home</Eyebrow>
        {/* B59.35 — Settings opens from the top right of Home (launch pack design, DECISIONS 3). */}
        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud }}>
            <Icon name="settings" color={c.ink} />
          </Pressable>
        </Link>
      </View>
      <Headline>{waiting ? `${waiting} waiting for you` : 'Nothing waiting for you'}</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          {data.prepared.map((r) => (
            <PreparedPaymentCard key={r.id} request={r} />
          ))}
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} agentName={nameOf(a.agent_id)} capability={approvalCapability(a, data.book.agents ?? [])} onDecided={reload} />
          ))}

          <MoneyHeader capability={AGENT_CREDIT}>Safe to spend</MoneyHeader>
          <Money micros={safeToSpend(data.book, data.approvals)} peg={peg} balance />
          <Body muted>Your workspace balance, less what is waiting for your approval.</Body>
          <Link href="/activity" asChild>
            <Pressable accessibilityRole="link" style={{ minHeight: 48, justifyContent: 'center' }}>
              <Body style={{ color: c.tangerineInk }}>See all in Activity</Body>
            </Pressable>
          </Link>

          <Eyebrow>Agents</Eyebrow>
          {agents.length === 0 ? <Body muted>No agents yet.</Body> : null}
          {agents.map((a) => (
            <Link key={a.id} href={{ pathname: '/agents/[id]', params: { id: a.id } }} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={`${a.name}, ${a.paused_at ? 'paused' : 'active'}`}>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <Face agent={a} state={a.paused_at ? 'asleep' : 'happy'} waiting={pending.some((p) => p.agent_id === a.id)} size={44} />
                    <View style={{ flex: 1 }}>
                      <Body>{a.name}</Body>
                      <Body muted style={{ color: a.paused_at ? c.caution : c.positive }}>{a.paused_at ? 'Paused' : 'Active'}</Body>
                    </View>
                    <Money micros={a.balance_ulxc} peg={peg} size={17} balance />
                  </View>
                </Card>
              </Pressable>
            </Link>
          ))}
        </>
      ) : null}
    </Screen>
  )
}
