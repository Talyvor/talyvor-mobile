import { formatULXC } from '@talyvor/bff-client'
import { useCallback } from 'react'
import { View } from 'react-native'

import { Body, Card, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { useTheme } from '@/theme'

const day = (d: Date) => d.toISOString().slice(0, 10)

/** This month's statement across every agent wallet, newest line first. */
export default function StatementScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const now = new Date()
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    const [book, statement] = await Promise.all([client.book(), client.statement(day(from), day(to))])
    return { agents: book.agents ?? [], statement }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const accountName = (account: string) =>
    account.startsWith('agent:') ? (data?.agents.find((a) => `agent:${a.id}` === account)?.name ?? account.slice(6)) : account
  const lines = [...(data?.statement.lines ?? [])].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Statement</Eyebrow>
      <Headline>This month</Headline>
      <LoadState loading={loading && !data} error={error} />
      {(data?.statement.accounts ?? []).map((a) => (
        <View key={a.account} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Body>{accountName(a.account)}</Body>
          <Figure>{formatULXC(a.closing_ulxc)}</Figure>
        </View>
      ))}
      {data && lines.length === 0 ? <Body muted>No money moved this month.</Body> : null}
      {lines.length ? <Eyebrow>Every movement</Eyebrow> : null}
      {lines.map((l) => (
        <Card key={l.posting_id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Body style={{ flex: 1 }}>{l.label || l.memo || `${l.kind} · ${l.counterparty}`}</Body>
            <Figure tone={l.amount_ulxc < 0 ? c.ink : c.positive}>
              {l.amount_ulxc > 0 ? '+' : ''}
              {formatULXC(l.amount_ulxc)}
            </Figure>
          </View>
          <Body muted>
            {accountName(l.account)} · {new Date(l.at).toLocaleString()}
          </Body>
        </Card>
      ))}
    </Screen>
  )
}
