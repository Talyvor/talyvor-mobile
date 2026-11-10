import { BffError, formatMinor, refusalText, type PaymentRequest } from '@talyvor/bff-client'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { MoneyHeader, paymentRequestCapabilities } from '@/components/money-label'
import { Body, Button, Card, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { approveBatch, payWord, totalsOf } from '@/approve-batch'
import { biometricName } from '@/keys'
import { syncLiveActivities } from '@/live-activity'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B40.14 — the approval card of a request prepared for approval (B40.9 on the web), where talyvor://approve/<id> and its
// push notification land: every item with its payee, amount, reference and the rule that asked; the person unticks what
// they will not pay and approves the rest with Face ID or a fingerprint over the statement Lens writes for exactly those,
// or declines the whole request (B55.11).

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

  return (
    <Screen
      onRefresh={() => {
        setDone(null)
        setDeclined(false)
        reload()
      }}
      refreshing={loading && !!data}>
      <MoneyHeader capability={r ? paymentRequestCapabilities([r]) : []}>Approve payments</MoneyHeader>
      <Headline>{r?.summary || 'Payments waiting for your approval'}</Headline>
      {notFound ? <Body muted>There is no request at this address. It may belong to another workspace.</Body> : <LoadState loading={loading && !data} error={error} />}
      {r ? (
        <Card>
          <Body muted>
            From {agent ? `${agent}’s account` : 'the company’s account'} · asked by {askedBy(r.client)} · {new Date(r.created_at).toLocaleString()}
          </Body>
          {pending ? (
            <Body>
              {ticked.length} of {payWord(asked.length)} to approve
              {ticked.length ? (
                <>
                  , total <Figure>{totalsOf(ticked)}</Figure>
                </>
              ) : null}
            </Body>
          ) : (
            <Body style={{ color: r.status === 'approved' ? c.positive : c.ink }}>
              {declined && r.status === 'cancelled' ? 'Declined. Nothing waiting here will be paid.' : (DECIDED[r.status] ?? 'Nothing waiting here will be paid.')}
            </Body>
          )}
          {r.items.map((it) => {
            const payee = data?.payees?.find((p) => p.id === it.payee_id)
            const choosable = pending && it.decision === 'needs_approval'
            const on = !unticked.has(it.position)
            return (
              <View key={it.position} style={{ flexDirection: 'row', gap: 12, borderTopWidth: 1, borderColor: c.line, paddingTop: 10 }}>
                {choosable ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Approve ${formatMinor(it.amount_minor, it.currency)} to ${it.payee_name}`}
                    onPress={() => toggle(it.position)}
                    hitSlop={12}
                    style={{ width: 22, height: 22, marginTop: 2, borderRadius: 4, borderWidth: 1.5, borderColor: on ? c.accent : c.lineStrong, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Text style={{ color: c.onAccent, fontFamily: fonts.uiBold, fontSize: 14 }}>✓</Text> : null}
                  </Pressable>
                ) : null}
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                    <Body style={{ flex: 1 }}>{it.payee_name || it.listing_id}</Body>
                    <Figure>{formatMinor(it.amount_minor, it.currency)}</Figure>
                  </View>
                  {it.payee_id && data?.payees && data.payments ? (
                    <Body muted>
                      {paidBefore.has(it.payee_id) ? 'Known payee' : 'New payee'} · {payee && !payee.needs_confirmation ? 'Verified' : 'Not verified'}
                    </Body>
                  ) : null}
                  {it.reference ? <Body muted>Reference: {it.reference}</Body> : null}
                  <Body muted>
                    {it.decision === 'auto'
                      ? 'Inside a permission you signed: paid without asking you.'
                      : it.decision === 'blocked'
                        ? `Blocked: ${it.reason}.`
                        : `Asks for approval: ${it.reason}.`}
                  </Body>
                  {it.pay_status ? <Body>{payWords(it)}</Body> : null}
                </View>
              </View>
            )
          })}
          {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
          {pending ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Button primary label={busy ? 'Approving…' : `Approve ${payWord(ticked.length)} with ${biometricName}`} disabled={busy || declining || !ticked.length} onPress={() => void approve()} />
              <Button label="Decline" disabled={busy || declining} onPress={() => setDeclining(true)} />
            </View>
          ) : pay === '1' ? (
            // "Pay my bills" (B40.17) walks the bills due one card at a time; each still needs its own approval.
            <Button label="Next bill due" onPress={() => router.replace({ pathname: '/bills', params: { pay: '1' } })} />
          ) : null}
        </Card>
      ) : null}
      {pending && declining ? (
        <Card>
          <Body>Decline these payments? Nothing waiting here is paid.</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
            <Button primary label="Decline" disabled={busy} onPress={() => void decline()} />
            <Button label="Keep it" disabled={busy} onPress={() => setDeclining(false)} />
          </View>
        </Card>
      ) : null}
    </Screen>
  )
}
