import { BffError, formatLXC, formatMinor, refusalText, type Agent, type AgentApproval, type PaymentRequest } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { onDay } from '../activity'
import { notApproved } from '../approve-batch'
import { biometricName, phoneKey, signWithThisPhone } from '../keys'
import { syncLiveActivities } from '../live-activity'
import { haptic } from '../motion'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { AgentCard } from './card'
import { Face } from './face'
import { Icon, type IconName } from './icon'
import { say, Tick, TopLine } from './live'
import { SheetCover } from './lock-screen'
import { moneyParts } from './money'
import { MoneyLabel, approvalCapability } from './money-label'
import { preparedBy, preparedPayee, preparedTotal } from './prepared-payment-card'
import { Body, Button, Card, Chip, Eyebrow, Field, Headline, Row, Sheet } from './ui'

// B57.67 — deciding on the phone as Pocket draws it (design/pocket p-home+psheet-A, psheet-L, p-approved-acme,
// p-declined-acme, p-approved-lead, p-declined-lead): a row with Review, the approval sheet over the screen you are on,
// and the result screen after Face ID, with Next when another request waits. Signing is B50.10's, unchanged.

type Who = Pick<Agent, 'id' | 'name' | 'colour' | 'face' | 'paused_at'>

/** An approval's agent from the book; one the book no longer has is named by its id. */
const agentOf = (agents: readonly Who[], id: string): Who => agents.find((a) => a.id === id) ?? { id, name: id }

/** What the agent wants: pay a payee, use a listing, or ask a model. */
const verb = (a: AgentApproval) => (!a.payee ? 'ask' : a.payee.kind === 'listing' ? 'use' : 'pay')
const subject = (a: AgentApproval) => (a.payee ? a.payee.name || a.payee.id : a.model)

/** B59.23 — a 3-D Secure check on the agent's card (Lens B59.22): the merchant asked, not the agent, and Lens takes its
 * answer only signed, a decline too. */
const isCardCheck = (a: AgentApproval) => a.kind === 'card_challenge'

/** `Research wants to pay Acme Hosting`: a row's title, and Next's. */
export const approvalTitle = (name: string, a: AgentApproval) =>
  isCardCheck(a) ? `${name}’s card: confirm a payment at ${subject(a)}` : `${name} wants to ${verb(a)} ${subject(a)}`

/** What a decline did, said where the person declined it (B55.20, the web's words from B55.19); a listing's use is a
 * request, as the reference's p-declined-lead says. */
export const declinedText = (agentName: string, a: AgentApproval) =>
  isCardCheck(a)
    ? `Declined. The card payment at ${subject(a)} does not go through.`
    : `Declined. ${agentName}’s ${a.payee && a.payee.kind !== 'listing' ? 'payment' : 'request'} is refused, and the same request is refused without asking you for 24 hours.`

/** What an approval does next, or that its agent is paused (the reference's p-approved-acme and p-approved-lead). */
export function approvedText(name: string, a: AgentApproval, paused: boolean) {
  if (isCardCheck(a)) return `The card payment at ${subject(a)} goes ahead.`
  const what = !a.payee ? `${name}’s request` : a.payee.kind === 'listing' ? `${name}’s use of ${subject(a)}` : `${name}’s payment to ${subject(a)}`
  return paused
    ? `${name} is paused: ${what} goes through once ${name} runs again and sends it, within 24 hours.`
    : `${what} goes through the next time it sends it, once. Your approval lasts 24 hours.`
}

/** B59.56 — a Business payment over the second-approver line, after the first of its two approvals (suite B28.40's words). */
export const WAITING_FOR_SECOND = 'Approved by you. Waiting for a second approver.'

/** B59.56 — Lens's refusals of an approval over the second-approver line (B28.315's codes), in the web's words; '' for any other. */
export function secondApproverRefusal(err: unknown) {
  const code = err instanceof BffError ? err.code : ''
  if (code === 'same_approver') return WAITING_FOR_SECOND
  if (code === 'second_approver_needed') return 'Your second approver must be one of the two approvals. Nothing was paid.'
  if (code === 'approver_unknown') return 'Over the second approver line, only a person signed in to Talyvor can approve. Nothing was paid.'
  return ''
}

/** How a decided approval ended, in B57.68's words: never Denied or Approved and spent. */
export function decidedWords(a: AgentApproval) {
  switch (a.status) {
    case 'approved':
      return 'Approved'
    case 'denied':
      return 'Declined'
    case 'used':
      return a.payee && a.payee.kind !== 'listing' ? 'Approved and paid' : 'Approved and used'
    case 'expired':
      return 'Expired'
  }
  return 'Closed'
}

/** B62.11 — why a payment it approved was stopped (Lens B62.9), in the web's B62.10 words; null when none was. */
export const stoppedText = (a: AgentApproval) => (a.stopped ? `Stopped: the ${a.stopped.changed} changed after you approved.` : null)

/** The amount in the currency that pays it: an account's or a card's own, else dollars (B61.15: never LXC beside it). */
export function amountParts(a: AgentApproval, peg: number | null) {
  if ((a.paid_from?.kind === 'account' || a.paid_from?.kind === 'card') && a.paid_from.currency) return { large: formatMinor(a.paid_from.amount_minor, a.paid_from.currency), small: null }
  return moneyParts(formatLXC(a.amount_ulxc, peg))
}

/** `$420.00 of $2,000.00`, or the amount alone while the monthly limit is unread. */
function budgetWords(left: number, limit: number, peg: number | null) {
  if (!limit) return formatLXC(left, peg)
  return `${formatLXC(left, peg)} of ${formatLXC(limit, peg)}`
}

/** B61.15 — what pays it, unless it is the agent's credit, which is the parked gateway's and is not drawn. */
const paidFrom = (a: AgentApproval) => (a.paid_from && a.paid_from.kind !== 'lxc' ? a.paid_from : null)

/** `Research’s US dollar account (holds $400.00)`; the bill and a card hold nothing. */
function paidFromWords(p: NonNullable<AgentApproval['paid_from']>) {
  if (p.balance_minor === null) return p.name
  return `${p.name} (holds ${formatMinor(p.balance_minor, p.currency)})`
}

/** `Tomorrow at 09:17`, as the phone's clock reads it. */
export function expiresWords(at: string, now = new Date()) {
  const t = new Date(Date.parse(at.replace(/(\.\d{3})\d+/, '$1')))
  const time = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(t) - day(now)) / 86_400_000)
  if (days === 0) return `Today at ${time}`
  if (days === 1) return `Tomorrow at ${time}`
  return `${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} at ${time}`
}

/** `Face ID on this iPhone`: what signed it. */
const signedWith = `${biometricName === 'Face ID' ? 'Face ID' : 'Your fingerprint'} on this ${Platform.OS === 'ios' ? 'iPhone' : 'phone'}`

export type Fact = readonly [label: string, value: string, note?: string]

/** B62.4 — what the agent says a payment is for, as every screen shows it (suite B62.3's TaskSays): after these words and
 * nothing else, never as a fact. Nothing when it gave none. */
export function TaskSays({ task }: { task?: string }) {
  if (!task) return null
  return (
    <Body muted>{`The agent says: “${task}”`}</Body>
  )
}

/** The sheet's and the result's facts: a label on the left, its value on the right, a rule between; a row's note under its
 * value in 13 ink-3, as launch-pack P8 draws "this month" under Budget left after. `on="cloud"` draws them on the page
 * plane, for facts inside a cloud section (B57.191, a payment's Proof). */
export function Facts({ rows, testID, on }: { rows: (Fact | null)[]; testID?: string; on?: 'cloud' }) {
  const { c } = useTheme()
  const shown = rows.filter((r): r is Fact => r !== null)
  return (
    <View testID={testID} style={{ backgroundColor: on === 'cloud' ? c.page : c.cloud, borderRadius: 16, paddingHorizontal: 14 }}>
      {shown.map(([label, value, note], i) => (
        <View key={label} style={{ paddingVertical: 12, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
          <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Body muted style={{ flexShrink: 1, maxWidth: '55%' }}>
              {label}
            </Body>
            <Body style={{ flex: 1, textAlign: 'right', fontFamily: fonts.uiMedium }}>{value}</Body>
          </View>
          {note ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3, textAlign: 'right' }}>{note}</Text> : null}
        </View>
      ))}
    </View>
  )
}

/** The amount large, and a note under it small. */
function Amount({ large, small, size }: { large: string; small: string | null; size: number }) {
  const { c } = useTheme()
  return (
    <View accessible accessibilityLabel={small ? `${large} (${small})` : large} style={{ gap: 2 }}>
      <Text style={{ fontFamily: fonts.display, fontSize: size, letterSpacing: -0.03 * size, color: c.ink, fontVariant: ['tabular-nums'] }}>{large}</Text>
      {small ? <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink3, fontVariant: ['tabular-nums'] }}>{small}</Text> : null}
    </View>
  )
}

/** One approval waiting for the owner, in a list: who wants what, how much, Live or Sandbox, and Review. */
export function ApprovalCard({ approval, agent, capability, label = true, onReview }: { approval: AgentApproval; agent: Who; capability: string; label?: boolean; onReview: () => void }) {
  const { peg } = useSession()
  const { c } = useTheme()
  const title = approvalTitle(agent.name, approval)
  return (
    <Card white>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Face agent={agent} waiting size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Body style={{ fontFamily: fonts.uiMedium }}>{title}</Body>
          <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink3, fontVariant: ['tabular-nums'] }}>{formatLXC(approval.amount_ulxc, peg)}</Text>
        </View>
        <Button primary small label="Review" accessibilityLabel={`Review: ${title}`} onPress={onReview} />
      </View>
      <TaskSays task={approval.task} />
      {label ? <MoneyLabel capability={capability} /> : null}
    </Card>
  )
}

export type Decided = {
  approval: AgentApproval
  agent: Who
  capability: string
  approved: boolean
  signed: boolean
  paused: boolean
  next: { id: string; title: string } | null
  /** B59.56: the first of two approvals over the second-approver line, still waiting for the second */
  waiting?: boolean
}

/** The approval sheet: what is asked, what pays it, the budget left after, when it expires, and approve or decline with
 * this phone's key. Decline asks why first: optional, kept by Lens and shown to the agent (B55.18). */
export function ApprovalSheet({
  approval: a,
  agent,
  capability,
  paused,
  refused = '',
  onDecided,
  onApprovals,
}: {
  approval: AgentApproval
  agent: Who
  capability: string
  paused: boolean
  /** B57.105: what Lens refused when Approve was pressed on the notification that opened this sheet */
  refused?: string
  onDecided: (approved: boolean, signed: boolean, waiting?: boolean) => void
  onApprovals: () => void
}) {
  const { client, peg } = useSession()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(refused)
  const [declining, setDeclining] = useState(false)
  const [why, setWhy] = useState('')
  // Whether this phone signs for this workspace; undefined while it is read.
  const [signs, setSigns] = useState<boolean>()
  const [monthly, setMonthly] = useState(0)
  const hasBudget = a.budget_left_after_ulxc != null
  useEffect(() => {
    let live = true
    phoneKey(client).then(
      (k) => live && setSigns(!!k?.here),
      () => live && setSigns(false),
    )
    if (hasBudget)
      client.rules(a.agent_id).then(
        (r) => live && setMonthly(r.monthly_limit_ulxc),
        () => undefined,
      )
    return () => {
      live = false
    }
  }, [client, a.agent_id, hasBudget])
  const { large, small } = amountParts(a, peg)
  const what = a.payee ? 'payment' : 'request'
  const card = isCardCheck(a)

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true)
    setRefusal('')
    try {
      // With this phone's key on, Lens takes the decision only signed: Face ID or a fingerprint, over this approval's challenge.
      // Approving moves money, so on a phone it is never made unsigned (B50.10); declining moves none and may be.
      // A key made in another workspace is no key here: Lens refuses it.
      // A card check is answered only signed, so its decline needs the key as much as its approval does.
      const key = await phoneKey(client)
      const mustSign = decision === 'approve' || card
      if (mustSign && !key) throw new Error(`turn on approving with ${biometricName} on this phone first.`)
      if (mustSign && !key?.here) throw new Error(`approving with ${biometricName} is off for this workspace.`)
      // Face ID shows the amount as the sheet does.
      const what = `${decision === 'approve' ? 'Approve' : 'Decline'} ${small ? `${large} (${small})` : large}`
      const assertion = key?.here
        ? await signWithThisPhone(client, (await client.approvalChallenge(a.id)).challenge, card ? `${what} at ${subject(a)} on ${a.paid_from?.name ?? `${agent.name}’s card`}` : `${what} for ${agent.name}`)
        : undefined
      const got = decision === 'approve' ? await client.approve(a.id, assertion) : await client.deny(a.id, assertion, why.trim())
      void syncLiveActivities(client)
      if (decision === 'approve') haptic('success')
      onDecided(decision === 'approve', !!assertion, decision === 'approve' && !!got?.waiting_for_second_approver)
    } catch (err) {
      if (decision === 'approve' && err instanceof BffError) haptic('warning')
      // B57.105: an approval that did not happen says so as the notification's Approve does: Nothing was approved.
      setRefusal(secondApproverRefusal(err) || (decision === 'approve' ? notApproved(err) : err instanceof BffError ? refusalText(err) : `Nothing changed: ${(err as Error).message}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View testID="approval-sheet" style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {card ? <AgentCard agent={agent} width={72} /> : <Face agent={agent} waiting size={40} />}
        <View style={{ flex: 1 }}>
          <Body style={{ fontFamily: fonts.uiBold }}>{card ? 'Confirm a card payment' : `${agent.name} wants to ${verb(a)}`}</Body>
          {card || a.memo || a.reason ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{card ? (a.paid_from?.name ?? `${agent.name}’s card`) : a.memo || a.reason}</Text>
          ) : null}
        </View>
        <MoneyLabel capability={capability} />
      </View>
      <Amount large={large} small={small} size={54} />
      <Body>
        {card ? 'at ' : a.payee ? 'to ' : ''}
        <Text style={{ fontFamily: fonts.uiBold }}>{subject(a)}</Text>
      </Body>
      {a.memo && a.reason ? <Body muted>“{a.reason}”</Body> : null}
      <TaskSays task={a.task} />
      <Facts
        testID="approval-facts"
        rows={[
          card ? ['Why it’s asking', `${subject(a)} asked the card to check with you`] : null,
          a.over_second_approver_line
            ? ['Why it’s asking', 'Over the second approver line']
            : a.asks_above_ulxc != null
              ? ['Why it’s asking', `It asks you above ${formatLXC(a.asks_above_ulxc, peg)}`]
              : null,
          paidFrom(a) ? ['Paid from', paidFromWords(paidFrom(a)!)] : null,
          hasBudget ? ['Budget left after', budgetWords(a.budget_left_after_ulxc!, monthly, peg)] : null,
          a.expires_at ? ['Expires', expiresWords(a.expires_at), card ? 'No answer by then declines it.' : undefined] : null,
        ]}
      />
      {paused && !card ? <Body muted>{`${agent.name} is paused: nothing goes through until it runs again. An approval lasts 24 hours.`}</Body> : null}
      {/* B57.214: drawn as B57.208's note on tangerine, with the clock for a wait */}
      {a.waiting_for_second_approver ? <TangerineNote icon="clock" testID="second-note" text="Approved once. Waiting for a second approver." /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Icon name="check" size={16} color={c.ink2} />
        <Body muted style={{ flex: 1, fontSize: 13, lineHeight: 18 }}>
          {`This approves this ${what} only.${signs ? ` Approving or declining asks for ${biometricName}.` : ''}`}
        </Body>
      </View>
      {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
      {signs === false ? (
        <>
          <Body muted>{`Turn on Approve with ${biometricName} on this phone first.`}</Body>
          <Button primary label="Approvals on this phone" onPress={onApprovals} />
        </>
      ) : null}
      {declining ? (
        <>
          <Field label="Why (optional, the agent sees it)" value={why} onChangeText={setWhy} maxLength={200} autoFocus />
          <Button primary label="Decline" haptic={false} disabled={busy} hint="Declining…" onPress={() => void decide('deny')} />
          <Button variant="secondary" label="Cancel" disabled={busy} onPress={() => setDeclining(false)} />
        </>
      ) : (
        <>
          {signs ? <Button primary icon={biometricName === 'Face ID' ? 'faceid' : 'key'} label={`Approve with ${biometricName}`} disabled={busy} hint="Approving…" onPress={() => void decide('approve')} /> : null}
          {!card ? <Button variant="secondary" label="Decline" haptic={false} disabled={busy} onPress={() => setDeclining(true)} /> : null}
          {card && signs ? <Button variant="secondary" label="Decline" haptic={false} disabled={busy} hint="Declining…" onPress={() => void decide('deny')} /> : null}
        </>
      )}
    </View>
  )
}

/** After deciding: the check or the x, what happens next, the payee and the amount, what signed it, what pays it and the
 * budget left; Done, and Next when another request waits. */
/** B61.78 — the one line at the top after a decision: the reference's "Approved. $64.00 to Acme" and "Declined. Nothing was sent". */
export function decidedLine(d: Pick<Decided, 'approval' | 'agent' | 'approved' | 'waiting'>, amount: string) {
  if (!d.approved) return 'Declined. Nothing was sent'
  if (d.waiting) return WAITING_FOR_SECOND
  return d.approval.payee ? `Approved. ${amount} to ${subject(d.approval)}` : `Approved. ${amount} for ${d.agent.name}`
}

export function ApprovalResult({ d, onDone, onNext }: { d: Decided; onDone: () => void; onNext: (id: string) => void }) {
  const { peg } = useSession()
  const { c } = useTheme()
  const a = d.approval
  const { large, small } = amountParts(a, peg)
  const left = a.budget_left_after_ulxc
  // B61.78 — Face ID, then the tick that draws itself, then one line at the top for 2.3 s; said once, as it lands.
  const line = decidedLine(d, large)
  useEffect(() => {
    say(line, d.approved ? 'check' : 'x')
  }, [line, d.approved])
  return (
    <SafeAreaView testID="approval-result" style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 32 }}>
          {d.approved ? (
            <Tick />
          ) : (
            <View style={{ width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger50 }}>
              <Icon name="x" size={36} color={c.danger} />
            </View>
          )}
          {/* B57.214: one short headline as p-approved-acme draws Approved; the wait is a note in the card */}
          <Headline>{d.waiting ? 'Approved by you' : d.approved ? 'Approved' : 'Declined'}</Headline>
          <Body muted style={{ textAlign: 'center' }}>
            {d.waiting ? 'Nothing is paid until a second person approves it.' : d.approved ? approvedText(d.agent.name, a, d.paused) : declinedText(d.agent.name, a)}
          </Body>
        </View>
        <Card white>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {isCardCheck(a) ? <AgentCard agent={d.agent} width={48} /> : <Face agent={d.agent} size={30} />}
            <Body style={{ flex: 1, fontFamily: fonts.uiBold }}>{subject(a)}</Body>
            <MoneyLabel capability={d.capability} />
          </View>
          <Amount large={large} small={small ? `${small} for its rules` : null} size={30} />
          {d.waiting ? <TangerineNote icon="clock" testID="second-note" text="Waiting for a second approver." /> : null}
          <Facts
            rows={
              d.approved
                ? [
                    d.signed ? ['Signed with', signedWith] : null,
                    paidFrom(a) ? [paidFrom(a)!.kind === 'marketplace_bill' ? 'Charged to' : 'Paid from', paidFrom(a)!.name] : null,
                    left != null ? ['Budget left once it goes through', formatLXC(left, peg)] : null,
                  ]
                : [d.signed ? ['Declined with', signedWith] : null, left != null ? [`${d.agent.name}’s budget left`, formatLXC(left + a.amount_ulxc, peg)] : null]
            }
          />
        </Card>
        <Button primary label="Done" onPress={onDone} />
        {d.next ? <Button variant="secondary" label={`Next: ${d.next.title}`} onPress={() => onNext(d.next!.id)} /> : null}
      </ScrollView>
      <TopLine />
    </SafeAreaView>
  )
}

/** When a decided approval was decided: an expired one nobody answered, when it expired (B57.68). */
const decidedAt = (a: AgentApproval) => a.decided_at ?? a.expires_at ?? a.created_at
const decidedOn = (a: AgentApproval) => onDay(decidedAt(a))

/** B57.150 — how a prepared payment ended: approved ones are paid as they are approved, a cancelled one was declined. */
const preparedWords = (r: PaymentRequest) => (r.status === 'approved' ? 'Approved and paid' : r.status === 'cancelled' ? 'Declined' : 'Expired')

/** B57.68 — what was decided: `Research · Acme Hosting`, how it ended and when, the amount dollars first; each row opens
 * the approval's own screen. B57.150: payments prepared for you sit among them, `Chat · Northwind Data`, newest first,
 * each opening its approval card. */
export function DecidedApprovals({ decided, agents, prepared = [] }: { decided: AgentApproval[]; agents: readonly Who[]; prepared?: PaymentRequest[] }) {
  const { peg } = useSession()
  const { c } = useTheme()
  const rows = [
    ...decided.map((a) => ({
      key: a.id,
      at: decidedAt(a),
      title: `${agentOf(agents, a.agent_id).name} · ${subject(a)}`,
      sub: stoppedText(a) ?? `${decidedWords(a)} · ${decidedOn(a)}`,
      stopped: !!a.stopped,
      ...amountParts(a, peg),
      open: () => router.push({ pathname: '/approvals/[id]', params: { id: a.id } }),
    })),
    ...prepared.map((r) => ({
      key: r.id,
      at: r.decided_at ?? r.created_at,
      title: `${preparedBy(r.client)} · ${preparedPayee(r)}`,
      sub: `${preparedWords(r)} · ${onDay(r.decided_at ?? r.created_at)}`,
      large: preparedTotal(r),
      small: null as string | null,
      stopped: false,
      open: () => router.push({ pathname: '/approve/[id]', params: { id: r.id } }),
    })),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
  if (!rows.length) return null
  return (
    <Card white>
      <Eyebrow>Decided</Eyebrow>
      <View>
        {rows.map(({ key, title, sub, large, small, stopped, open }, i) => (
          <Row
            key={key}
            first={i === 0}
            title={title}
            sub={sub}
            subTone={stopped ? c.tangerineInk : undefined}
            right={
              <View accessible accessibilityLabel={small ? `${large} (${small})` : large} style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.display, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{large}</Text>
                {small ? <Text style={{ fontFamily: fonts.uiMedium, fontSize: 12.5, color: c.ink3, fontVariant: ['tabular-nums'] }}>{small}</Text> : null}
              </View>
            }
            onPress={open}
          />
        ))}
      </View>
    </Card>
  )
}

/** B57.78 — what a decided request was, in a sentence, when Lens kept the approval amount it was above. */
function whatItWas(a: AgentApproval, agentName: string, peg: number | null) {
  if (a.asks_above_ulxc == null) return null
  const kind = !a.payee ? 'A request' : a.payee.kind === 'listing' ? 'A marketplace listing' : 'A payment'
  return `${kind}, above ${agentName}’s ${moneyParts(formatLXC(a.asks_above_ulxc, peg)).large} approval amount.`
}

/** B57.78 — how it ended and when: an expired one says whether nobody answered or the approval went unused. */
function endedWords(a: AgentApproval) {
  if (a.status === 'expired')
    return `Expired ${onDay(a.expires_at ?? a.decided_at ?? a.created_at)}: ${a.decided_at ? 'approved, but not used within 24 hours' : 'nobody answered within 24 hours'}.`
  return `${decidedWords(a)} ${decidedOn(a)}.`
}

/** B57.208 — why a payment it approved was stopped, as Pocket's note: the sentence on tangerine with the shield's mark,
 * inside the request's card. B57.214: the clock's, for an approval waiting for its second approver. */
function TangerineNote({ text, icon = 'shield', testID = 'stopped-note' }: { text: string; icon?: IconName; testID?: string }) {
  const { c } = useTheme()
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.tangerine50 }}>
      <Icon name={icon} size={20} color={c.tangerineInk} />
      <Text style={{ flex: 1, fontFamily: fonts.uiMedium, fontSize: 13.5, lineHeight: 19, color: c.tangerineInk }}>{text}</Text>
    </View>
  )
}

/** B57.78 — a decided request where its notification lands, as Pocket's p-approval-landing draws it: what it was and how
 * it ended, then why nothing opens here, with the way to Approvals. B57.208: a stopped one's sentence is a note in its
 * card; a used one's card carries the agent's `task` under what it was and its `proof` last, as B57.191's receipt does. */
export function DecidedCard({ approval: a, agentName, task, proof }: { approval: AgentApproval; agentName: string; task?: string; proof?: ReactNode }) {
  const { peg } = useSession()
  const { c } = useTheme()
  const what = whatItWas(a, agentName, peg)
  const stopped = stoppedText(a)
  return (
    <>
      <Card white>
        <View testID="decided-card" style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{`${subject(a)} · ${amountParts(a, peg).large}`}</Text>
            <Chip>{decidedWords(a)}</Chip>
          </View>
          {what ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink2 }}>{what}</Text> : null}
          <TaskSays task={task} />
          {stopped ? <TangerineNote text={stopped} /> : null}
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>{`${endedWords(a)} Nothing is waiting for you here.`}</Text>
          {proof}
        </View>
      </Card>
      <Card>
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink2 }}>
          A notification for a request still waiting opens its approval sheet. One that was decided, or expired after 24 hours, says so here.
        </Text>
        <View style={{ flexDirection: 'row' }}>
          <Button small variant="secondary" label="Approvals" onPress={() => router.push('/approvals')} />
        </View>
      </Card>
    </>
  )
}

/** B57.105 — where an agent's approval notification's Approve with Face ID lands: Pocket's p-approved-acme, as approving
 * in the sheet shows it, signed with this phone's key; Next goes on to the next request waiting. */
export function ApprovedFromNotification({
  approval: a,
  agents,
  allPaused,
  pending,
  onDone,
}: {
  approval: AgentApproval
  agents: readonly Who[]
  allPaused: boolean
  pending: AgentApproval[]
  onDone: () => void
}) {
  const agent = agentOf(agents, a.agent_id)
  const next = pending.find((x) => x.id !== a.id)
  const d: Decided = {
    approval: a,
    agent,
    capability: approvalCapability(a, agents),
    approved: true,
    signed: true,
    paused: allPaused || !!agent.paused_at,
    next: next ? { id: next.id, title: approvalTitle(agentOf(agents, next.agent_id).name, next) } : null,
  }
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDone}>
      <ApprovalResult d={d} onDone={onDone} onNext={(id) => router.replace({ pathname: '/approvals/[id]', params: { id } })} />
      <SheetCover />
    </Modal>
  )
}

/** The requests waiting for the owner, each a row with Review; Review opens the sheet over the screen, and deciding shows
 * the result screen in the same window, so one closing never races the other opening. `focus` shows only that request's
 * row and opens its sheet, for the screen a notification lands on. */
export function PendingApprovals({
  pending,
  agents,
  allPaused,
  focus,
  refused,
  labels = true,
  onDecided,
}: {
  pending: AgentApproval[]
  agents: readonly Who[]
  allPaused: boolean
  focus?: string
  /** B57.105: Lens's refusal of the focused request, from its notification's Approve, said on its sheet */
  refused?: string
  /** each row's own Live or Sandbox; Approvals draws one for the screen instead (B57.68) */
  labels?: boolean
  onDecided: () => void
}) {
  const [open, setOpen] = useState<string | null>(focus ?? null)
  const [result, setResult] = useState<Decided | null>(null)
  const sheet = pending.find((a) => a.id === open)
  const close = () => {
    setOpen(null)
    setResult(null)
  }
  const capabilityOf = (a: AgentApproval) => approvalCapability(a, agents)

  return (
    <>
      {pending
        .filter((a) => !focus || a.id === focus)
        .map((a) => (
          <ApprovalCard key={a.id} approval={a} agent={agentOf(agents, a.agent_id)} capability={capabilityOf(a)} label={labels} onReview={() => setOpen(a.id)} />
        ))}
      <Modal visible={!!sheet || !!result} transparent animationType="slide" onRequestClose={close}>
        {result ? (
          <ApprovalResult
            d={result}
            onDone={close}
            onNext={(id) => {
              setResult(null)
              setOpen(id)
            }}
          />
        ) : sheet ? (
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,18,22,0.4)' }}>
            <Pressable accessible={false} style={{ flex: 1 }} onPress={close} />
            <Sheet onClose={close}>
              <ApprovalSheet
                key={sheet.id}
                approval={sheet}
                agent={agentOf(agents, sheet.agent_id)}
                capability={capabilityOf(sheet)}
                paused={allPaused || !!agentOf(agents, sheet.agent_id).paused_at}
                refused={sheet.id === focus ? refused : undefined}
                onApprovals={() => {
                  close()
                  router.push('/approvals')
                }}
                onDecided={(approved, signed, waiting) => {
                  const agent = agentOf(agents, sheet.agent_id)
                  const next = pending.find((x) => x.id !== sheet.id)
                  setResult({
                    approval: sheet,
                    agent,
                    capability: capabilityOf(sheet),
                    approved,
                    signed,
                    paused: allPaused || !!agent.paused_at,
                    next: next ? { id: next.id, title: approvalTitle(agentOf(agents, next.agent_id).name, next) } : null,
                    waiting,
                  })
                  setOpen(null)
                  onDecided()
                }}
              />
            </Sheet>
          </View>
        ) : null}
        <SheetCover />
      </Modal>
    </>
  )
}
