import { BffError, formatMinor, refusalText, type PaymentRequest } from '@talyvor/bff-client'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'

import { onDay } from '@/activity'
import { approveBatch, payWord, totalsOf } from '@/approve-batch'
import { Icon } from '@/components/icon'
import { MoneyHeader, paymentRequestCapabilities } from '@/components/money-label'
import { Back, Body, Button, Card, Figure, Headline, LoadState, Screen, Sheet, useLoad } from '@/components/ui'
import { biometricName } from '@/keys'
import { syncLiveActivities } from '@/live-activity'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B40.14 — the approval card of a request prepared for approval (B40.9 on the web), where talyvor://approve/<id> and its
// push notification land: every item with its payee, amount, reference and the rule that asked; the person unticks what
// they will not pay and approves the rest with Face ID or a fingerprint over the statement Lens writes for exactly those,
// or declines the whole request (B55.11). B57.74: drawn as Pocket's p-approve-req, each payment its own card, Decline asking
// in a sheet, and a line after each payment Lens tried saying what happened to it.

const DECIDED: Record<string, string> = {
  approved: 'Approved. Each payment you approved is paid once.',
  cancelled: 'This request was cancelled. Nothing will be paid.',
  auto: 'Nothing here needs your approval: each payment is inside a permission you signed.',
  blocked: 'Nothing here can be paid: every payment was blocked.',
  expired: 'This request expired: nobody approved it within 24 hours. Nothing waiting was paid.',
}

/** Where one item stands once paying it was tried, in words: never Lens's own status. */
const payWords = (it: PaymentRequest['items'][number]) =>
  ({
    pending: 'On its way',
    sent: 'Sent',
    completed: 'Paid',
    failed: 'Not paid: it failed',
    returned: 'Came back',
    refused: `Not paid: ${it.pay_detail}`,
    not_approved: 'Not paid: you left it out',
    not_paid: 'Not paid: a marketplace purchase is not paid from here yet',
    held: `Held for 24 hours, as ${it.payee_name} is a new payee`,
  })[it.pay_status ?? ''] ?? 'Not paid yet'

/** Who prepared it, in words: Lens names the client "chat", "voice", "mcp:<client id>" or "key:<key id>" (B40.3). */
const askedBy = (client: string) =>
  client.startsWith('mcp:') ? 'an assistant you connected' : client.startsWith('key:') ? 'an agent' : client === 'chat' ? 'Chat' : client === 'voice' ? 'a voice request' : client

/** `Pay Northwind Data $180.00` for one payment; the summary Lens keeps for a batch. */
const headline = (r: PaymentRequest) =>
  r.summary || (r.items.length === 1 ? `Pay ${r.items[0].payee_name || r.items[0].listing_id} ${formatMinor(r.items[0].amount_minor, r.items[0].currency)}` : 'Payments waiting for your approval')

export default function ApproveScreen() {
  const { id, pay } = useLocalSearchParams<{ id: string; pay?: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [request, book, payees, payments] = await Promise.all([
      client.paymentRequest(id),
      client.book(),
      // Known and verified are read from the payees and past payments; unread, they are not claimed either way.
      client.payees().catch(() => null),
      client.payments().catch(() => null),
    ])
    return { request, agents: book.agents ?? [], payees: payees?.payees ?? null, payments: payments?.payments ?? null }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const [done, setDone] = useState<PaymentRequest | null>(null)
  const [unticked, setUnticked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [declining, setDeclining] = useState(false)
  const [declined, setDeclined] = useState(false)

  const notFound = error instanceof BffError && error.status === 404
  const r = done ?? data?.request
  const asked = r?.items.filter((it) => it.decision === 'needs_approval') ?? []
  const ticked = asked.filter((it) => !unticked.has(it.position))
  const pending = r?.status === 'pending_approval'
  const toggle = (p: number) => setUnticked((s) => (s.has(p) ? new Set([...s].filter((x) => x !== p)) : new Set(s).add(p)))
  const agent = r?.agent_id ? (data?.agents.find((a) => a.id === r.agent_id)?.name ?? r.agent_id) : ''
  const paidBefore = new Set((data?.payments ?? []).filter((p) => p.status === 'completed').map((p) => p.payee_id))
  /** Known (a saved payee), verified, and whether it is the first payment to them; unread, none of it is claimed. */
  const payeeFacts = (payeeId: string) => {
    if (!data?.payees || !data.payments) return []
    const payee = data.payees.find((p) => p.id === payeeId)
    return [payee ? 'Known payee' : 'New payee', payee && !payee.needs_confirmation ? 'Verified' : 'Not verified', paidBefore.has(payeeId) ? '' : 'First payment']
  }

  const approve = async () => {
    setBusy(true)
    setRefusal('')
    try {
      setDone(await approveBatch(client, r!.id, ticked))
      void syncLiveActivities(client)
    } catch (err) {
      setRefusal(err instanceof BffError ? refusalText(err) : `Nothing was approved: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const decline = async () => {
    setBusy(true)
    setRefusal('')
    try {
      setDone(await client.cancelRequest(r!.id))
      setDeclined(true)
      setDeclining(false)
      void syncLiveActivities(client)
    } catch (err) {
      setRefusal(err instanceof BffError ? refusalText(err) : `Nothing was declined: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** One line for each payment Lens tried to pay: `Northwind Data, $180.00: Paid.` */
  const tried = r?.items.filter((it) => it.pay_status) ?? []

  return (
    <Screen
      onRefresh={() => {
        setDone(null)
        setDeclined(false)
        reload()
      }}
      refreshing={loading && !!data}>
      <Back home="/approvals" />
      <MoneyHeader capability={r ? paymentRequestCapabilities([r]) : []}>Approve payments</MoneyHeader>
      <Headline>{r ? headline(r) : 'Payments waiting for your approval'}</Headline>
      {notFound ? <Body muted>There is no request at this address. It may belong to another workspace.</Body> : <LoadState loading={loading && !data} error={error} />}
      {r ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>
          From {agent ? `${agent}’s account` : 'the company’s account'} · prepared by {askedBy(r.client)} · {onDay(r.created_at)}
        </Text>
      ) : null}
      {pending && asked.length > 1 ? (
        <Body>
          {ticked.length} of {payWord(asked.length)} to approve
          {ticked.length ? (
            <>
              , total <Figure>{totalsOf(ticked)}</Figure>
            </>
          ) : null}
        </Body>
      ) : null}
      {r?.items.map((it) => {
        const choosable = pending && it.decision === 'needs_approval'
        const on = !unticked.has(it.position)
        const facts = [...(it.payee_id ? payeeFacts(it.payee_id) : []), it.reference ? `Reference: ${it.reference}` : ''].filter(Boolean)
        return (
          <Card white key={it.position}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {choosable ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Approve ${formatMinor(it.amount_minor, it.currency)} to ${it.payee_name}`}
                  onPress={() => toggle(it.position)}
                  hitSlop={12}
                  style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: on ? c.accent : c.lineStrong, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Text style={{ color: c.onAccent, fontFamily: fonts.uiBold, fontSize: 14 }}>✓</Text> : null}
                </Pressable>
              ) : null}
              <Body style={{ flex: 1, fontFamily: fonts.uiBold }}>{it.payee_name || it.listing_id}</Body>
              <Figure>{formatMinor(it.amount_minor, it.currency)}</Figure>
            </View>
            {facts.length ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>{facts.join(' · ')}</Text> : null}
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink2 }}>
              {it.decision === 'auto'
                ? 'Inside a permission you signed: paid without asking you.'
                : it.decision === 'blocked'
                  ? `Blocked: ${it.reason}.`
                  : `Asks for approval: ${it.reason}.`}
            </Text>
          </Card>
        )
      })}
      {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
      {pending ? (
        // Behind the Decline sheet, its buttons are hidden from a screen reader as well as disabled.
        <View aria-hidden={declining} style={{ gap: 10 }}>
          <Button primary label={busy ? 'Approving…' : `Approve ${payWord(ticked.length)} with ${biometricName}`} disabled={busy || declining || !ticked.length} onPress={() => void approve()} />
          <Button variant="secondary" label="Decline" disabled={busy || declining} onPress={() => setDeclining(true)} />
        </View>
      ) : r ? (
        <Card tight>
          <Body style={{ fontFamily: fonts.uiBold, color: r.status === 'approved' ? c.positive : c.ink }}>
            {declined && r.status === 'cancelled' ? 'Declined. Nothing waiting here will be paid.' : (DECIDED[r.status] ?? 'Nothing waiting here will be paid.')}
          </Body>
          {tried.map((it) => (
            <Text key={it.position} style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>
              {`${it.payee_name || it.listing_id}, ${formatMinor(it.amount_minor, it.currency)}: ${payWords(it)}.`}
            </Text>
          ))}
        </Card>
      ) : null}
      {!pending && pay === '1' ? (
        // "Pay my bills" (B40.17) walks the bills due one card at a time; each still needs its own approval.
        <Button label="Next bill due" onPress={() => router.replace({ pathname: '/bills', params: { pay: '1' } })} />
      ) : null}
      <Modal visible={pending && declining} transparent animationType="slide" onRequestClose={() => setDeclining(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,18,22,0.4)' }}>
          <Pressable accessible={false} style={{ flex: 1 }} onPress={() => setDeclining(false)} />
          <Sheet>
            <View testID="decline-sheet" style={{ gap: 14 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => setDeclining(false)} style={{ alignSelf: 'flex-end' }}>
                <Icon name="x" color={c.ink2} />
              </Pressable>
              <Headline>Decline these payments?</Headline>
              <Body muted>Nothing waiting here is paid.</Body>
              {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
              <Button variant="danger" label="Decline" disabled={busy} hint="Declining…" onPress={() => void decline()} />
              <Button variant="secondary" label="Keep it" disabled={busy} onPress={() => setDeclining(false)} />
            </View>
          </Sheet>
        </View>
      </Modal>
    </Screen>
  )
}
