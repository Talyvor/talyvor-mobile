import { formatLXC, refusalText, type StatementFormat } from '@talyvor/bff-client'
import { File, Paths } from 'expo-file-system'
import { useLocalSearchParams } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { AGENT_CREDIT, MoneyHeader } from '@/components/money-label'
import { Body, Button, Card, Eyebrow, Field, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { ACTIVITY_KINDS, day, filterLines, monthPeriod } from '@/activity'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B59.35 — Activity, from Home and from an agent: every movement in a month, filtered by agent, by kind and by words as
// the web's statement is (suite B28.51), and the statement for the period to download as the web's Download writes it.

const FORMATS: readonly [StatementFormat, string][] = [
  ['csv', 'CSV'],
  ['json', 'JSON'],
  ['pdf', 'PDF'],
  ['journal', 'Journal for Xero or QuickBooks'],
]

const MIME: Record<StatementFormat, string> = { csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', journal: 'text/csv' }

/** A choice of one, as a row of pills that scrolls sideways. */
function Pills<T extends string | number | null>({ label, options, value, onChange }: { label: string; options: readonly [T, string][]; value: T; onChange: (v: T) => void }) {
  const { c } = useTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={label} contentContainerStyle={{ gap: 8 }}>
      {options.map(([v, words]) => {
        const on = v === value
        return (
          <Pressable
            key={String(v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(v)}
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, backgroundColor: on ? c.ink : c.cloud2 }}>
            <Text style={{ fontFamily: fonts.uiMedium, fontSize: 15, color: on ? c.page : c.ink }}>{words}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

export default function ActivityScreen() {
  const { client, peg } = useSession()
  const { c } = useTheme()
  const params = useLocalSearchParams<{ agent?: string }>()
  const [month, setMonth] = useState<'this' | 'last'>('this')
  const [agent, setAgent] = useState<string | null>(params.agent ?? null)
  const [kindAt, setKindAt] = useState(0)
  const [q, setQ] = useState('')
  const [format, setFormat] = useState<StatementFormat>('csv')
  const [preparing, setPreparing] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  const period = monthPeriod(month)
  const load = useCallback(async () => {
    const [book, statement] = await Promise.all([client.book(), client.statement(period.from, period.to)])
    return { agents: book.agents ?? [], lines: statement.lines ?? [] }
  }, [client, period.from, period.to])
  const { data, error, loading, reload } = useLoad(load)
  const agents = data?.agents ?? []
  const who = agent ? `${agents.find((a) => a.id === agent)?.name ?? 'This agent'}’s` : 'every agent’s'
  const accountName = (account: string) =>
    account.startsWith('agent:') ? (agents.find((a) => `agent:${a.id}` === account)?.name ?? account.slice(6)) : account
  const lines = filterLines(data?.lines ?? [], { agent, kinds: ACTIVITY_KINDS[kindAt].kinds, q })

  const download = async () => {
    setPreparing(true)
    setSaid(null)
    try {
      const stem = agent ? (agents.find((a) => a.id === agent)?.name ?? 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent' : 'agent-wallets'
      const last = day(new Date(Date.parse(period.to) - 86_400_000))
      const name = format === 'journal' ? `${stem}-journal-${period.from}-to-${last}.csv` : `${stem}-statement-${period.from}-to-${last}.${format}`
      const file = new File(Paths.cache, name)
      if (file.exists) file.delete()
      file.create()
      file.write(new Uint8Array(await client.statementFile(agent, period.from, period.to, format)))
      await Sharing.shareAsync(file.uri, { mimeType: MIME[format], dialogTitle: name })
      setSaid(`Saved ${name}.`)
    } catch (err) {
      setSaid(refusalText(err))
    } finally {
      setPreparing(false)
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <MoneyHeader capability={AGENT_CREDIT}>Activity</MoneyHeader>
      <Headline>{month === 'this' ? 'This month' : 'Last month'}</Headline>
      <Pills label="Period" options={[['this', 'This month'], ['last', 'Last month']] as const} value={month} onChange={setMonth} />
      <Pills label="Agent" options={[[null, 'Every agent'], ...agents.map((a): [string, string] => [a.id, a.name])]} value={agent} onChange={setAgent} />
      <Pills label="Kind of line" options={ACTIVITY_KINDS.map((k, i): [number, string] => [i, k.label])} value={kindAt} onChange={setKindAt} />
      <Field label="Search" placeholder="Search" maxLength={200} value={q} onChangeText={setQ} />
      <LoadState loading={loading && !data} error={error} />
      {data && lines.length === 0 ? <Body muted>{data.lines.length > 0 ? 'No line matches.' : month === 'this' ? 'No money moved this month.' : 'No money moved last month.'}</Body> : null}
      {lines.map((l) => (
        <Card key={l.posting_id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Body style={{ flex: 1 }}>{l.label || l.memo || `${l.kind} · ${l.counterparty}`}</Body>
            <Figure tone={l.amount_ulxc < 0 ? c.ink : c.positive}>
              {l.amount_ulxc > 0 ? '+' : ''}
              {formatLXC(l.amount_ulxc, peg)}
            </Figure>
          </View>
          <Body muted>
            {accountName(l.account)} · {new Date(l.at).toLocaleString()}
          </Body>
        </Card>
      ))}

      <Eyebrow>Download</Eyebrow>
      <Card>
        <Body muted>
          Download {who} statement for a period: the opening balance, every movement with its posting and entry, and the closing balance. Days are UTC; the last day is
          included. The journal imports into Xero or QuickBooks: each entry one balanced journal, each agent its cost centre.
        </Body>
        <Pills label={`File type of ${who} statement`} options={FORMATS} value={format} onChange={setFormat} />
        <Button primary label={preparing ? 'Preparing…' : 'Download'} disabled={preparing} onPress={() => void download()} />
        {said ? <Body muted>{said}</Body> : null}
      </Card>
    </Screen>
  )
}
