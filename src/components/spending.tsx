import { type CoachLine, formatMinor, type NoticeSettings, type SpendBudget, type SpendFinding, type SpendNotice, type SpendPayment, type SpendSubscription } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { byCategory, byCurrency, categoryName, day, noticeMore, RULES } from '../spending'
import { fonts, useTheme } from '../theme'
import { Money } from './money'
import { NoticeSettingsCard } from './notice-settings'
import { Back, Bar, Body, Card, Eyebrow, Figure, Headline, Row } from './ui'

// B57.92 — Spending and a payment's notice in Pocket's cards (design/pocket p-spending and p-notice, in the order Pocket
// Live's Activity draws its Spending, Budgets and Subscriptions): every number from Lens, in its own currency.

export interface SpendingData {
  week: ReturnType<typeof byCategory>
  month: ReturnType<typeof byCurrency>
  payments: SpendPayment[]
  findings: (SpendFinding & { line?: CoachLine })[]
  budgets: SpendBudget[]
  subs: SpendSubscription[]
  notices: SpendNotice[]
  settings: NoticeSettings
  agents: { id: string; name: string }[]
}

const IN_WORDS: Record<string, string> = { USD: 'US dollars', EUR: 'euros', GBP: 'British pounds' }

/** Whose a payment, budget or finding is: "" the owner's own wallet, "all" every wallet, else the agent's name. */
const whoseOf = (agents: SpendingData['agents']) => (id: string | undefined) =>
  !id ? 'Your own wallet' : id === 'all' ? 'Every wallet' : (agents.find((a) => a.id === id)?.name ?? 'An agent')

/** Words for an empty list, in a card as the reference draws them. */
function Empty({ children }: { children: string }) {
  return (
    <Card>
      <Body muted>{children}</Body>
    </Card>
  )
}

export function SpendingView({ data }: { data: SpendingData }) {
  const whose = whoseOf(data.agents)
  const row = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'baseline' as const, gap: 12 }
  const open = (id: string) => router.push({ pathname: '/notices/[id]', params: { id } })

  return (
    <>
      {data.month.length === 0 ? (
        <Card>
          <Eyebrow>Spent this month</Eyebrow>
          <Body muted>Nothing spent yet.</Body>
        </Card>
      ) : null}
      {data.month.map((m) => (
        <Card key={m.currency}>
          <Eyebrow>Spent this month</Eyebrow>
          <View style={{ gap: 2 }}>
            <Money minor={m.total} currency={m.currency} size={34} />
            <Body muted>By you and your agents, in {IN_WORDS[m.currency] ?? m.currency}</Body>
          </View>
          {m.categories.map(([cat, minor]) => (
            <View key={cat} style={{ gap: 8, paddingTop: 6 }}>
              <View style={row}>
                <Body style={{ flex: 1, fontFamily: fonts.uiMedium }}>{categoryName(cat)}</Body>
                <Figure>{formatMinor(minor, m.currency)}</Figure>
              </View>
              <Bar thin value={minor / m.total} label={`${categoryName(cat)}: share of this month’s ${m.currency} spending`} />
            </View>
          ))}
        </Card>
      ))}

      <Card>
        <Eyebrow>This week, from Monday</Eyebrow>
        {data.week.length === 0 ? <Body muted>Nothing spent yet.</Body> : null}
        {data.week.map(([cat, amount]) => (
          <View key={cat} style={row}>
            <Body style={{ flex: 1, fontFamily: fonts.uiMedium }}>{categoryName(cat)}</Body>
            <Figure>{amount}</Figure>
          </View>
        ))}
      </Card>

      <Eyebrow>Budgets</Eyebrow>
      {data.budgets.length === 0 ? <Empty>No budget yet. Set one in Talyvor on the web.</Empty> : null}
      {data.budgets.map((b) => {
        const label = `${categoryName(b.category)} · ${whose(b.agent_id)}`
        return (
          <Card key={b.id}>
            <View style={row}>
              <Body style={{ flex: 1, fontFamily: fonts.uiMedium }}>{label}</Body>
              <Body muted>
                <Text style={{ fontFamily: fonts.uiMedium, fontVariant: ['tabular-nums'] }}>{formatMinor(b.spent_minor, b.currency)}</Text> of{' '}
                <Text style={{ fontFamily: fonts.uiMedium, fontVariant: ['tabular-nums'] }}>{formatMinor(b.amount_minor, b.currency)}</Text>
              </Body>
            </View>
            <Bar value={b.percent / 100} label={`${label}: budget used`} />
            <Body muted>
              This {b.period} · <Text style={{ fontFamily: fonts.uiMedium, fontVariant: ['tabular-nums'] }}>{formatMinor(Math.abs(b.left_minor), b.currency)}</Text>{' '}
              {b.left_minor >= 0 ? 'left' : 'over'}
            </Body>
          </Card>
        )
      })}

      <Eyebrow>Unusual this month</Eyebrow>
      {data.findings.length === 0 ? <Empty>Nothing unusual this month.</Empty> : null}
      {data.findings.length > 0 ? (
        <Card>
          {data.findings.map((f, i) => (
            <View key={`${f.rule}-${f.entry_id ?? f.at}-${i}`}>
              <Row
                first={i === 0}
                title={`${RULES[f.rule] ?? f.rule} · ${f.merchant || (f.category ? categoryName(f.category) : whose(f.agent_id))}`}
                sub={f.line?.sentence}
                right={f.amount_minor !== undefined && f.currency ? <Figure>{formatMinor(f.amount_minor, f.currency)}</Figure> : undefined}
              />
              {f.line?.help?.map((h) => (
                <Body key={h.name} muted>
                  {h.name} ({h.url.replace(/^https:\/\//, '')}): {h.for}.
                </Body>
              ))}
            </View>
          ))}
        </Card>
      ) : null}

      <Eyebrow>This month’s payments</Eyebrow>
      {data.payments.length === 0 ? <Empty>No payment this month yet.</Empty> : null}
      {data.payments.length > 0 ? (
        <Card>
          {data.payments.map((p, i) => (
            <Row
              key={p.entry_id}
              first={i === 0}
              title={p.merchant || 'A payment'}
              sub={`${categoryName(p.category)} · ${day(p.created_at)} · ${whose(p.agent_id)}`}
              right={<Figure>{formatMinor(p.amount_minor, p.currency)}</Figure>}
            />
          ))}
        </Card>
      ) : null}

      <Eyebrow>Subscriptions</Eyebrow>
      {data.subs.length === 0 ? <Empty>No subscription found yet: one shows after its third payment.</Empty> : null}
      {data.subs.length > 0 ? (
        <Card>
          {data.subs.map((s, i) => (
            <Row
              key={`${s.agent_id ?? ''}-${s.merchant}-${s.amount_minor}`}
              first={i === 0}
              title={s.merchant}
              sub={`${formatMinor(s.amount_minor, s.currency)} ${s.interval} · next ${day(s.next_at)} · ${whose(s.agent_id)}`}
              right={<Figure>{formatMinor(s.yearly_minor, s.currency)} a year</Figure>}
            />
          ))}
        </Card>
      ) : null}

      <Eyebrow>Notices</Eyebrow>
      <NoticeSettingsCard initial={data.settings} />
      {data.notices.length > 0 ? (
        <Card>
          {data.notices.slice(0, 10).map((n, i) => (
            <Row key={n.id} first={i === 0} title={n.title} sub={`${n.body} · ${day(n.created_at)}`} onPress={() => open(n.id)} />
          ))}
        </Card>
      ) : null}
    </>
  )
}

export interface NoticeData {
  notice: SpendNotice | null
  payment: SpendPayment | null
  agents: { id: string; name: string }[]
}

/** Where a spending notice lands: the payment it is about, and what the notice says beyond its category. */
export function NoticeView({ data }: { data: NoticeData | null }) {
  const { c } = useTheme()
  const n = data?.notice
  const p = data?.payment
  const more = n ? noticeMore(n.body, p?.category) : ''

  return (
    <>
      <Back home="/spending" to="Spending" />
      <Eyebrow>{n?.title ?? 'Payment'}</Eyebrow>
      <Headline>{p ? p.merchant || 'A payment' : (n?.title ?? 'Payment')}</Headline>
      {data && !n ? <Body muted>There is no notice at this address. It may belong to another workspace.</Body> : null}
      {p ? (
        <Card>
          <Money minor={p.amount_minor} currency={p.currency} size={34} />
          <View style={{ gap: 2 }}>
            <Body style={{ fontFamily: fonts.uiMedium }}>{categoryName(p.category)}</Body>
            <Body muted>
              {`${day(p.created_at)} · ${new Date(p.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${whoseOf(data.agents)(p.agent_id)}`}
            </Body>
          </View>
        </Card>
      ) : null}
      {more ? <Body muted>{more}</Body> : null}
      {n ? (
        <Pressable accessibilityRole="link" onPress={() => router.navigate('/spending')} style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Body style={{ color: c.tangerineInk }}>See all your spending</Body>
        </Pressable>
      ) : null}
    </>
  )
}
