import { formatMinor, refusalText, type NoticeSettings } from '@talyvor/bff-client'
import { Link } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, Switch, Text, TextInput, View } from 'react-native'

import { Body, Button, Card, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { byCategory, categoryName, day, NOTICE_KINDS, RULES, spendPeriod } from '@/spending'
import { fonts, useTheme } from '@/theme'

/** B53.9 — the web's Spending screen (B53.8) on the phone: every number from Lens, this week and this month by category,
 * budgets, what was unusual with the Coach's sentence, the month's payments, subscriptions, and when notices arrive. */
export default function SpendingScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const week = spendPeriod('week')
    const month = spendPeriod('month')
    const [w, m, unusual, coach, budgets, subs, notices, book] = await Promise.all([
      client.spending(week.from, week.to),
      client.spending(month.from, month.to),
      client.unusual(month.from, month.to),
      client.coach(),
      client.budgets(),
      client.subscriptions(),
      client.notices(),
      client.book(),
    ])
    // The Coach's sentence on each finding: the line for its rule and merchant (a sensitive merchant's line names none).
    const lines = [...(coach.lines ?? [])]
    const findings = (unusual.findings ?? []).map((f) => {
      const i = lines.findIndex((l) => l.fact.kind === f.rule && (l.fact.merchant === undefined || l.fact.merchant === f.merchant))
      return { ...f, line: i < 0 ? undefined : lines.splice(i, 1)[0] }
    })
    return {
      week: byCategory(w),
      month: byCategory(m),
      payments: m.payments ?? [],
      findings,
      budgets: budgets.budgets ?? [],
      subs: subs.subscriptions ?? [],
      notices: notices.notices ?? [],
      settings: notices.settings,
      agents: book.agents ?? [],
    }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const whose = (id: string | undefined) =>
    !id ? 'Your own wallet' : id === 'all' ? 'Every wallet' : (data?.agents.find((a) => a.id === id)?.name ?? 'An agent')

  // What the person has changed, over Lens's settings, until they save.
  const [edits, setSettings] = useState<NoticeSettings | null>(null)
  const settings = edits ?? data?.settings ?? null
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      setSettings(await client.setNoticeSettings({ ...settings, timezone: settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone }))
      setSaved('Saved.')
    } catch (err) {
      setSaved(refusalText(err))
    } finally {
      setSaving(false)
    }
  }
  const input = { borderWidth: 1, borderColor: c.lineStrong, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, color: c.ink, fontSize: 15, fontFamily: fonts.ui, width: 96 }
  const row = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: 12 }

  const totals = (title: string, cats: [string, string][]) => (
    <Card>
      <Body muted>{title}</Body>
      {cats.length === 0 ? <Body muted>Nothing spent yet.</Body> : null}
      {cats.map(([cat, amount]) => (
        <View key={cat} style={row}>
          <Body style={{ flex: 1 }}>{categoryName(cat)}</Body>
          <Figure>{amount}</Figure>
        </View>
      ))}
    </Card>
  )

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Spending</Eyebrow>
      <Headline>Where your money went</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          {totals('This week, from Monday', data.week)}
          {totals('This month', data.month)}

          <Eyebrow>Budgets</Eyebrow>
          {data.budgets.length === 0 ? <Body muted>No budget yet. Set one in Talyvor on the web.</Body> : null}
          {data.budgets.map((b) => {
            const pct = Math.min(100, Math.max(0, b.percent))
            const label = `${categoryName(b.category)} · ${whose(b.agent_id)}`
            return (
              <Card key={b.id}>
                <Body>{label}</Body>
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel={`${label}: budget used`}
                  accessibilityValue={{ min: 0, max: 100, now: pct }}
                  style={{ height: 8, borderRadius: 4, backgroundColor: c.lineStrong, overflow: 'hidden' }}>
                  <View style={{ width: `${pct}%`, height: 8, backgroundColor: b.percent >= 100 ? c.critical : b.percent >= 80 ? c.caution : c.accent }} />
                </View>
                <Body muted>
                  <Text style={{ fontFamily: fonts.uiMedium, fontVariant: ['tabular-nums'] }}>{formatMinor(b.spent_minor, b.currency)}</Text> of{' '}
                  <Text style={{ fontFamily: fonts.uiMedium, fontVariant: ['tabular-nums'] }}>{formatMinor(b.amount_minor, b.currency)}</Text> this {b.period} ·{' '}
                  <Text style={{ fontFamily: fonts.uiMedium, fontVariant: ['tabular-nums'] }}>{formatMinor(Math.abs(b.left_minor), b.currency)}</Text> {b.left_minor >= 0 ? 'left' : 'over'}
                </Body>
              </Card>
            )
          })}

          <Eyebrow>Unusual this month</Eyebrow>
          {data.findings.length === 0 ? <Body muted>Nothing unusual this month.</Body> : null}
          {data.findings.map((f, i) => (
            <Card key={`${f.rule}-${f.entry_id ?? f.at}-${i}`}>
              <View style={row}>
                <Body style={{ flex: 1 }}>
                  {RULES[f.rule] ?? f.rule} · {f.merchant || (f.category ? categoryName(f.category) : whose(f.agent_id))}
                </Body>
                {f.amount_minor !== undefined && f.currency ? <Figure>{formatMinor(f.amount_minor, f.currency)}</Figure> : null}
              </View>
              {f.line ? <Body muted>{f.line.sentence}</Body> : null}
              {f.line?.help?.map((h) => (
                <Body key={h.name} muted>
                  {h.name} ({h.url.replace(/^https:\/\//, '')}): {h.for}.
                </Body>
              ))}
            </Card>
          ))}

          <Eyebrow>This month’s payments</Eyebrow>
          {data.payments.length === 0 ? <Body muted>No payment this month yet.</Body> : null}
          {data.payments.map((p) => (
            <Card key={p.entry_id}>
              <View style={row}>
                <Body style={{ flex: 1 }}>{p.merchant || 'A payment'}</Body>
                <Figure>{formatMinor(p.amount_minor, p.currency)}</Figure>
              </View>
              <Body muted>
                {categoryName(p.category)} · {day(p.created_at)} · {whose(p.agent_id)}
              </Body>
            </Card>
          ))}

          <Eyebrow>Subscriptions</Eyebrow>
          {data.subs.length === 0 ? <Body muted>No subscription found yet: one shows after its third payment.</Body> : null}
          {data.subs.map((s) => (
            <Card key={`${s.agent_id ?? ''}-${s.merchant}-${s.amount_minor}`}>
              <View style={row}>
                <Body style={{ flex: 1 }}>{s.merchant}</Body>
                <Figure>{formatMinor(s.yearly_minor, s.currency)} a year</Figure>
              </View>
              <Body muted>
                {formatMinor(s.amount_minor, s.currency)} {s.interval} · next {day(s.next_at)}
              </Body>
            </Card>
          ))}

          <Eyebrow>Notices</Eyebrow>
          {settings ? (
            <Card>
              <Body muted>Quiet hours hold every notice but an unusual payment until they end. Leave both empty for none.</Body>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput accessibilityLabel="Quiet from" placeholder="22:00" placeholderTextColor={c.inkMuted} value={settings.quiet_from} onChangeText={(v) => setSettings({ ...settings, quiet_from: v })} style={input} />
                <Body muted>to</Body>
                <TextInput accessibilityLabel="Quiet until" placeholder="07:00" placeholderTextColor={c.inkMuted} value={settings.quiet_until} onChangeText={(v) => setSettings({ ...settings, quiet_until: v })} style={input} />
              </View>
              {NOTICE_KINDS.map(([kind, name]) => {
                const off = settings.off ?? []
                return (
                  <View key={kind} style={[row, { alignItems: 'center' }]}>
                    <Body>{name}</Body>
                    <Switch
                      accessibilityLabel={name}
                      value={!off.includes(kind)}
                      onValueChange={(on) => setSettings({ ...settings, off: on ? off.filter((k) => k !== kind) : [...off, kind] })}
                      trackColor={{ true: c.accent, false: c.lineStrong }}
                    />
                  </View>
                )
              })}
              <Button primary label={saving ? 'Saving…' : 'Save notice settings'} disabled={saving} onPress={() => void save()} />
              {saved ? <Body muted>{saved}</Body> : null}
            </Card>
          ) : null}
          {data.notices.slice(0, 10).map((n) => (
            <Link key={n.id} href={{ pathname: '/notices/[id]', params: { id: n.id } }} asChild>
              <Pressable accessibilityRole="link">
                <Card>
                  <Body>{n.title}</Body>
                  <Body muted>
                    {n.body} · {day(n.created_at)}
                  </Body>
                </Card>
              </Pressable>
            </Link>
          ))}
        </>
      ) : null}
    </Screen>
  )
}
