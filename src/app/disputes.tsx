import type { CardDispute } from '@talyvor/bff-client'
import { useCallback, useState } from 'react'
import { View } from 'react-native'

import { CardExport, DisputePayment, DisputesAndRefunds, money } from '@/components/card-disputes'
import { Back, Body, Card, Eyebrow, Figure, Headline, LoadState, Row, Screen, useLoad } from '@/components/ui'
import { monthPeriod, when } from '@/activity'
import { DISPUTE_WORDS as W } from '@/dispute-words'
import { useSession } from '@/session'

// B59.26 — /disputes, from Cards: this month's card payments from each account's statement, each disputed from its line
// and then saying where its dispute stands; the workspace's disputes and refunds; and Export, as the web's B59.25 has them
// on Statements and the agent's card.

export default function DisputesScreen() {
  const { client } = useSession()
  const period = monthPeriod('this')
  const load = useCallback(async () => {
    const [accounts, disputes, refunds] = await Promise.all([client.moneyAccounts(), client.cardDisputes(), client.cardRefunds()])
    const statements = await Promise.all((accounts.accounts ?? []).map(async (a) => ({ a, s: await client.accountStatement(a.id, period.from, period.to) })))
    // A card payment is a card_charge line the issuer named; newest first across every account.
    const payments = statements
      .flatMap(({ a, s }) => (s.lines ?? []).filter((l) => l.kind === 'card_charge' && l.partner_ref).map((l) => ({ l, account: a.name, currency: s.currency })))
      .sort((x, y) => y.l.at.localeCompare(x.l.at))
    return { payments, disputes, refunds }
  }, [client, period.from, period.to])
  const { data, error, loading, reload } = useLoad(load)
  // The disputes sent from here, Lens's answers, ahead of the list read before them.
  const [sentHere, setSentHere] = useState<CardDispute[]>([])
  const [said, setSaid] = useState('')
  const disputes = [...sentHere, ...(data?.disputes ?? []).filter((d) => !sentHere.some((x) => x.id === d.id))]
  const sent = (d: CardDispute) => {
    setSentHere((xs) => [d, ...xs.filter((x) => x.id !== d.id)])
    setSaid(W.sent)
  }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/cards" />
      <Headline>{W.title}</Headline>
      <LoadState loading={loading && !data} error={error} />
      {said ? (
        <View accessibilityRole="alert">
          <Body>{said}</Body>
        </View>
      ) : null}
      {data?.payments.length ? (
        <Card white>
          {data.payments.map(({ l, account, currency }, i) => (
            <View key={`${l.entry_id}-${l.line}`} testID="card-payment">
              <Row
                first={i === 0}
                title={l.counterparty || W.cardPayment}
                sub={[account, when(l.at), W.cardPayment].filter(Boolean).join(' · ')}
                right={<Figure>{money(-l.amount_minor, currency)}</Figure>}
              />
              <View style={{ paddingBottom: 12 }}>
                <DisputePayment paymentId={l.partner_ref!} dispute={disputes.find((d) => d.payment_id === l.partner_ref)} onSent={sent} />
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      {data ? <DisputesAndRefunds disputes={disputes} refunds={data.refunds} /> : null}
      <Eyebrow>{W.export}</Eyebrow>
      <CardExport />
    </Screen>
  )
}
