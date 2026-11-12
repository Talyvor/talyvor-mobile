import { formatMinor, refusalText, type CardDispute, type CardRefund } from '@talyvor/bff-client'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { MessageBox } from '@/components/account-requests'
import { Body, Button, Card, Chip, Eyebrow, Field, Figure, Row } from '@/components/ui'
import { day, when } from '@/activity'
import { DISPUTE_WORDS as W, disputeState, exportName, exportedText, isDay, MAX_REASON } from '@/dispute-words'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B59.26 — card disputes, merchants' refunds and the card export on the phone, as the web's CardDisputes.tsx (suite
// B59.25) draws them on Lens B59.24. A card payment is named by the issuer's id for it, which its statement line carries
// (partner_ref). The owner disputes it with a reason; the issuer takes it and decides; a won dispute or a refund comes
// back to the account as its own statement line. Export hands the card payments, disputes and refunds of a date range,
// Lens's CSV, to the share sheet.

export const money = (minor: number, currency: string) => formatMinor(minor, currency.toUpperCase())

/** Where a dispute stands, in words, with what came back once it was won. */
export function DisputeChip({ dispute }: { dispute: CardDispute }) {
  const { text, tone } = disputeState(dispute, money)
  return (
    <View style={{ flexDirection: 'row' }} testID="dispute-state">
      <Chip tone={tone}>{text}</Chip>
    </View>
  )
}

/** On a card payment: where its dispute stands, or "Dispute this payment" and the reason it is disputed for. `onSent`
 * hands back the dispute Lens answered. */
export function DisputePayment({ paymentId, dispute, onSent }: { paymentId: string; dispute?: CardDispute; onSent: (d: CardDispute) => void }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState('')
  if (dispute) return <DisputeChip dispute={dispute} />
  if (!open) {
    return (
      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpen(true)} style={{ alignSelf: 'flex-start' }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: c.ink, textDecorationLine: 'underline' }}>{W.dispute}</Text>
      </Pressable>
    )
  }
  const said = reason.trim()
  const send = async () => {
    setSending(true)
    setRefusal('')
    try {
      onSent(await client.openCardDispute(paymentId, said))
      setOpen(false)
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setSending(false)
    }
  }
  return (
    <View style={{ gap: 8 }} testID="dispute-form">
      <MessageBox label={W.why} value={reason} onChange={(v) => setReason(v.slice(0, MAX_REASON))} />
      <Body muted>{W.issuerDecides}</Body>
      {said === '' ? <Body muted>{W.whyFirst}</Body> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Button small variant="primary" label={sending ? W.sending : W.send} disabled={sending || said === ''} hint={W.whyFirst} onPress={() => void send()} />
        <Button small label={W.cancel} onPress={() => setOpen(false)} />
      </View>
      {refusal ? (
        <View accessibilityRole="alert">
          <Body>{refusal}</Body>
        </View>
      ) : null}
    </View>
  )
}

/** Disputes and refunds as lines: each dispute with its payment, reason and state; each refund with what came back. */
export function DisputesAndRefunds({ disputes, refunds }: { disputes: CardDispute[]; refunds: CardRefund[] }) {
  const { c } = useTheme()
  if (!disputes.length && !refunds.length) return null
  return (
    <Card white>
      <Eyebrow>{W.title}</Eyebrow>
      {disputes.map((d, i) => (
        <View key={d.id} testID="card-dispute">
          <Row
            first={i === 0}
            title={d.merchant || W.aMerchant}
            sub={[money(d.amount_minor, d.currency), when(d.created_at), d.reason].join(' · ')}
            right={<DisputeChip dispute={d} />}
          />
        </View>
      ))}
      {refunds.map((r, i) => (
        <View key={r.id} testID="card-refund">
          <Row
            first={!disputes.length && i === 0}
            title={r.merchant || W.aMerchant}
            sub={`${W.refund} · ${when(r.created_at)}`}
            right={<Figure tone={c.positive}>{`+${money(r.credited_minor, r.currency)}`}</Figure>}
          />
        </View>
      ))}
    </Card>
  )
}

/** Export: the card payments, disputes and refunds of a date range, this month so far to start with, as Lens's CSV,
 * handed to the share sheet. */
export function CardExport({ now = new Date() }: { now?: Date }) {
  const { client } = useSession()
  const [from, setFrom] = useState(() => day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))))
  const [through, setThrough] = useState(() => day(now))
  const [saving, setSaving] = useState(false)
  const [said, setSaid] = useState('')
  const ready = isDay(from) && isDay(through) && through >= from
  const save = async () => {
    setSaving(true)
    setSaid('')
    try {
      const name = exportName(from, through)
      const file = new File(Paths.cache, name)
      if (file.exists) file.delete()
      file.create()
      file.write(new Uint8Array(await client.cardExportFile(from, through)))
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: name })
      setSaid(exportedText(from, through))
    } catch (err) {
      setSaid(refusalText(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <View testID="card-export">
      <Card>
        <Field label={W.from} value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false} />
        <Field label={W.to} value={through} onChangeText={setThrough} placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false} />
        {ready ? null : <Body muted>{W.range}</Body>}
        <Button variant="secondary" label={W.export} disabled={saving || !ready} hint={W.range} onPress={() => void save()} />
        {said ? <Body muted>{said}</Body> : null}
      </Card>
    </View>
  )
}
