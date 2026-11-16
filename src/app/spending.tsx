import { useCallback } from 'react'

import { type SpendingData, SpendingView } from '@/components/spending'
import { Back, Eyebrow, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { byCategory, byCurrency, spendPeriod } from '@/spending'

/** B53.9 — the web's Spending screen (B53.8) on the phone: every number from Lens, this week and this month by category,
 * budgets, what was unusual with the Coach's sentence, the month's payments, subscriptions, and when notices arrive.
 * B57.92: drawn in Pocket (components/spending.tsx). */
export default function SpendingScreen() {
  const { client } = useSession()
  const load = useCallback(async (): Promise<SpendingData> => {
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
      month: byCurrency(m),
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

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      {/* B61.54 — off the tab bar: it opens from Home and from Activity. */}
      <Back home="/" />
      <Eyebrow>Spending</Eyebrow>
      <Headline>Where your money went</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data ? <SpendingView data={data} /> : null}
    </Screen>
  )
}
