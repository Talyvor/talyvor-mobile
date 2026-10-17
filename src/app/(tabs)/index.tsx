import { formatULXC, safeToSpend } from '@talyvor/bff-client'
import { Link } from 'expo-router'
import { useCallback } from 'react'
import { Pressable, View } from 'react-native'

import { ApprovalCard } from '@/components/approval-card'
import { Body, Card, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { useTheme } from '@/theme'

/** Home: what waits for you first, then what you can safely spend, then each agent. */
export default function Home() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [book, approvals] = await Promise.all([client.book(), client.approvals()])
    return { book, approvals: approvals.approvals ?? [] }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const agents = (data?.book.agents ?? []).filter((a) => !a.archived_at)
  const pending = (data?.approvals ?? []).filter((a) => a.status === 'pending')
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Home</Eyebrow>
      <Headline>{pending.length ? `${pending.length} waiting for you` : 'Nothing waiting for you'}</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} agentName={nameOf(a.agent_id)} onDecided={reload} />
          ))}

          <Eyebrow>Safe to spend</Eyebrow>
          <Figure size={32}>{formatULXC(safeToSpend(data.book, data.approvals))}</Figure>
          <Body muted>Your workspace balance, less what is waiting for your approval.</Body>

          <Eyebrow>Agents</Eyebrow>
          {agents.length === 0 ? <Body muted>No agents yet.</Body> : null}
          {agents.map((a) => (
            <Link key={a.id} href={{ pathname: '/agents/[id]', params: { id: a.id } }} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={`${a.name}, ${a.paused_at ? 'paused' : 'active'}`}>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Body>{a.name}</Body>
                      <Body muted style={{ color: a.paused_at ? c.caution : c.positive }}>{a.paused_at ? 'Paused' : 'Active'}</Body>
                    </View>
                    <Figure>{formatULXC(a.balance_ulxc)}</Figure>
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
