import { formatBalance, formatLXC, refusalText } from '@talyvor/bff-client'
import { File, Paths } from 'expo-file-system'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { AGENT_CREDIT, MoneyLabel } from '@/components/money-label'
import { moneyParts } from '@/components/money'
import { Body, Button, Card, Eyebrow, Headline, LoadState, Row, Screen, useLoad } from '@/components/ui'
import { day, monthName, monthPeriod, when } from '@/activity'
import { agentOf, dayIn, lineWhat } from '@/statement'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B57.73 — the Statement tab as Pocket draws it (p-statement): the label, this month by name, each wallet now with its
// balance dollars first, and every movement newest first by model and day as Lens reads them (B57.13), each to its
// agent. Download CSV hands the month's statement, Lens's CSV of every posting, to the share sheet.

/** An amount as the statement draws it: the first figure over the one beside it, at the right; money in in green. */
function Amount({ written, moneyIn }: { written: string; moneyIn?: boolean }) {
  const { c } = useTheme()
  const sign = moneyIn ? '+' : ''
  const { large, small } = moneyParts(written)
  return (
    <View accessible accessibilityLabel={sign + written} style={{ alignItems: 'flex-end' }}>
      <Text style={{ fontFamily: fonts.display, fontSize: 15, color: moneyIn ? c.positive : c.ink, fontVariant: ['tabular-nums'] }}>{sign + large}</Text>
      {small ? <Text style={{ fontFamily: fonts.uiMedium, fontSize: 12.5, color: c.ink3, fontVariant: ['tabular-nums'] }}>{sign + small}</Text> : null}
    </View>
  )
}

export default function StatementScreen() {
  const { client, peg } = useSession()
  const [preparing, setPreparing] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const period = monthPeriod('this')
  const load = useCallback(async () => {
    // The catalog only names the models: a read that fails shows each model as Lens names it, and raises nothing.
    const [book, statement, models] = await Promise.all([client.book(), client.statementByDay(period.from, period.to), client.models().catch(() => null)])
    return { agents: book.agents ?? [], statement, models: models ?? [] }
  }, [client, period.from, period.to])
  const { data, error, loading, reload } = useLoad(load)
  const agents = data?.agents ?? []
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
  const accountName = (account: string) => {
    const id = agentOf(account)
    return id ? nameOf(id) : account
  }
  const modelOf = (id: string) => data?.models.find((m) => m.id === id)?.display_name || id
  const open = (account: string) => {
    const id = agentOf(account)
    return id ? () => router.push(`/agents/${id}`) : undefined
  }
  const lines = data?.statement.lines ?? []
  const today = dayIn(new Date(), data?.statement.time_zone || 'UTC')

  const download = async () => {
    setPreparing(true)
    setSaid(null)
    try {
      const name = `agent-wallets-statement-${period.from}-to-${day(new Date(Date.parse(period.to) - 86_400_000))}.csv`
      const file = new File(Paths.cache, name)
      if (file.exists) file.delete()
      file.create()
      file.write(new Uint8Array(await client.statementFile(null, period.from, period.to, 'csv')))
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: name })
      setSaid(`Saved ${name}.`)
    } catch (err) {
      setSaid(refusalText(err))
    } finally {
      setPreparing(false)
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>Statement</Headline>
        <MoneyLabel capability={AGENT_CREDIT} />
      </View>
      <Body muted>This month: {monthName(period.from)}</Body>
      <LoadState loading={loading && !data} error={error} />
      {data?.statement.accounts?.length ? (
        <Card white>
          <Eyebrow>Each wallet now</Eyebrow>
          {data.statement.accounts.map((a, i) => (
            <Row
              key={a.account}
              first={i === 0}
              title={accountName(a.account)}
              right={<Amount written={formatBalance(a.closing_ulxc, peg)} />}
              onPress={open(a.account)}
            />
          ))}
        </Card>
      ) : null}
      {data && lines.length === 0 ? <Body muted>No money moved this month.</Body> : null}
      {lines.length > 0 ? (
        <Card white>
          <Eyebrow>Every movement</Eyebrow>
          {lines.map((l, i) => {
            const [what, detail] = lineWhat(l, nameOf, modelOf, today)
            return (
              <Row
                key={`${l.entry_id}-${l.kind}-${l.day ?? ''}-${l.model ?? ''}-${l.posting_id}`}
                first={i === 0}
                title={what}
                sub={[accountName(l.account), when(l.at), detail].filter(Boolean).join(' · ')}
                right={<Amount written={formatLXC(l.amount_ulxc, peg)} moneyIn={l.amount_ulxc > 0} />}
                onPress={open(l.account)}
              />
            )
          })}
        </Card>
      ) : null}
      <Button variant="secondary" label={preparing ? 'Preparing…' : 'Download CSV'} disabled={preparing} onPress={() => void download()} />
      {said ? <Body muted>{said}</Body> : null}
    </Screen>
  )
}
