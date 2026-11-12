import { BffError, formatLXC, formatMinor, formatULXC, refusalText, type Agent, type AgentApproval } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { onDay } from '../activity'
import { biometricName, phoneKey, signWithThisPhone } from '../keys'
import { syncLiveActivities } from '../live-activity'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { Face } from './face'
import { Icon } from './icon'
import { moneyParts } from './money'
import { MoneyLabel, approvalCapability } from './money-label'
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

/** `Research wants to pay Acme Hosting`: a row's title, and Next's. */
export const approvalTitle = (name: string, a: AgentApproval) => `${name} wants to ${verb(a)} ${subject(a)}`

/** What a decline did, said where the person declined it (B55.20, the web's words from B55.19); a listing's use is a
 * request, as the reference's p-declined-lead says. */
export const declinedText = (agentName: string, a: AgentApproval) =>
  `Declined. ${agentName}’s ${a.payee && a.payee.kind !== 'listing' ? 'payment' : 'request'} is refused, and the same request is refused without asking you for 24 hours.`

/** What an approval does next, or that its agent is paused (the reference's p-approved-acme and p-approved-lead). */
export function approvedText(name: string, a: AgentApproval, paused: boolean) {
  const what = !a.payee ? `${name}’s request` : a.payee.kind === 'listing' ? `${name}’s use of ${subject(a)}` : `${name}’s payment to ${subject(a)}`
  return paused
    ? `${name} is paused: ${what} goes through once ${name} runs again and sends it, within 24 hours.`
    : `${what} goes through the next time it sends it, once. Your approval lasts 24 hours.`
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

/** The amount, dollars first: an account's own currency when an account pays it, the LXC its rules judge beside. */
export function amountParts(a: AgentApproval, peg: number | null) {
  if (a.paid_from?.kind === 'account' && a.paid_from.currency) return { large: formatMinor(a.paid_from.amount_minor, a.paid_from.currency), small: formatULXC(a.amount_ulxc) }
  return moneyParts(formatLXC(a.amount_ulxc, peg))
}

/** `$420.00 of $2,000.00 (4,200 of 20,000 LXC)`, or the amount alone while the monthly limit is unread. */
function budgetWords(left: number, limit: number, peg: number | null) {
  if (!limit) return formatLXC(left, peg)
  const l = moneyParts(formatLXC(left, peg))
  const m = moneyParts(formatLXC(limit, peg))
  return l.small && m.small ? `${l.large} of ${m.large} (${l.small.replace(/ LXC$/, '')} of ${m.small})` : `${l.large} of ${m.large}`
}

/** `Research’s US dollar account (holds $400.00)`; the bill and a card hold nothing. */
function paidFromWords(a: AgentApproval, peg: number | null) {
  const p = a.paid_from!
  if (p.balance_minor === null) return p.name
  const holds = p.kind === 'lxc' ? moneyParts(formatLXC(p.balance_minor, peg)).large : formatMinor(p.balance_minor, p.currency)
  return `${p.name} (holds ${holds})`
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

/** The sheet's and the result's facts: a label on the left, its value on the right, a rule between. */
function Facts({ rows }: { rows: (readonly [string, string] | null)[] }) {
  const { c } = useTheme()
  const shown = rows.filter((r): r is readonly [string, string] => r !== null)
  return (
    <View style={{ backgroundColor: c.cloud, borderRadius: 16, paddingHorizontal: 14 }}>
      {shown.map(([label, value], i) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`${label}: ${value}`}
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
          <Body muted style={{ flexShrink: 1, maxWidth: '55%' }}>
            {label}
          </Body>
          <Body style={{ flex: 1, textAlign: 'right', fontFamily: fonts.uiMedium }}>{value}</Body>
        </View>
      ))}
    </View>
  )
}

/** The amount large, and the LXC beside it small. */
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
      {label ? <MoneyLabel capability={capability} /> : null}
    </Card>
  )
}

export type Decided = { approval: AgentApproval; agent: Who; capability: string; approved: boolean; signed: boolean; paused: boolean; next: { id: string; title: string } | null }

/** The approval sheet: what is asked, what pays it, the budget left after, when it expires, and approve or decline with
 * this phone's key. Decline asks why first: optional, kept by Lens and shown to the agent (B55.18). */
export function ApprovalSheet({
  approval: a,
  agent,
  capability,
  paused,
  onDecided,
  onApprovals,
}: {
  approval: AgentApproval
  agent: Who
  capability: string
  paused: boolean
  onDecided: (approved: boolean, signed: boolean) => void
  onApprovals: () => void
}) {
  const { client, peg } = useSession()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
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

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true)
    setRefusal('')
    try {
      // With this phone's key on, Lens takes the decision only signed: Face ID or a fingerprint, over this approval's challenge.
      // Approving moves money, so on a phone it is never made unsigned (B50.10); declining moves none and may be.
      // A key made in another workspace is no key here: Lens refuses it.
      const key = await phoneKey(client)
      if (decision === 'approve' && !key) throw new Error(`turn on approving with ${biometricName} on this phone first.`)
      if (decision === 'approve' && !key?.here) throw new Error(`approving with ${biometricName} is off for this workspace.`)
      // Face ID shows the amount as the sheet does.
      const assertion = key?.here
        ? await signWithThisPhone(client, (await client.approvalChallenge(a.id)).challenge, `${decision === 'approve' ? 'Approve' : 'Decline'} ${small ? `${large} (${small})` : large} for ${agent.name}`)
        : undefined
      if (decision === 'approve') await client.approve(a.id, assertion)
      else await client.deny(a.id, assertion, why.trim())
      void syncLiveActivities(client)
      onDecided(decision === 'approve', !!assertion)
    } catch (err) {
      setRefusal(err instanceof BffError ? refusalText(err) : `Nothing changed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View testID="approval-sheet" style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Face agent={agent} waiting size={40} />
        <View style={{ flex: 1 }}>
          <Body style={{ fontFamily: fonts.uiBold }}>{`${agent.name} wants to ${verb(a)}`}</Body>
          {a.memo || a.reason ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{a.memo || a.reason}</Text> : null}
        </View>
        <MoneyLabel capability={capability} />
      </View>
      <Amount large={large} small={small} size={52} />
      <Body>
        {a.payee ? 'to ' : ''}
        <Text style={{ fontFamily: fonts.uiBold }}>{subject(a)}</Text>
      </Body>
      {a.memo && a.reason ? <Body muted>“{a.reason}”</Body> : null}
      <Facts
        rows={[
          a.asks_above_ulxc != null ? ['Why it’s asking', `It asks you above ${formatLXC(a.asks_above_ulxc, peg)}`] : null,
          a.paid_from ? ['Paid from', paidFromWords(a, peg)] : null,
          hasBudget ? ['Budget left after', budgetWords(a.budget_left_after_ulxc!, monthly, peg)] : null,
          a.expires_at ? ['Expires', expiresWords(a.expires_at)] : null,
        ]}
      />
      {paused ? <Body muted>{`${agent.name} is paused: nothing goes through until it runs again. An approval lasts 24 hours.`}</Body> : null}
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
          <Button primary label="Decline" disabled={busy} hint="Declining…" onPress={() => void decide('deny')} />
          <Button variant="secondary" label="Cancel" disabled={busy} onPress={() => setDeclining(false)} />
        </>
      ) : (
        <>
          {signs ? <Button primary label={`Approve with ${biometricName}`} disabled={busy} hint="Approving…" onPress={() => void decide('approve')} /> : null}
          <Button variant="secondary" label="Decline" disabled={busy} onPress={() => setDeclining(true)} />
        </>
      )}
    </View>
  )
}

/** After deciding: the check or the x, what happens next, the payee and the amount, what signed it, what pays it and the
 * budget left; Done, and Next when another request waits. */
export function ApprovalResult({ d, onDone, onNext }: { d: Decided; onDone: () => void; onNext: (id: string) => void }) {
  const { peg } = useSession()
  const { c } = useTheme()
  const a = d.approval
  const { large, small } = amountParts(a, peg)
  const left = a.budget_left_after_ulxc
  return (
    <SafeAreaView testID="approval-result" style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 32 }}>
          <View style={{ width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: d.approved ? c.success50 : c.danger50 }}>
            <Icon name={d.approved ? 'check' : 'x'} size={36} color={d.approved ? c.success : c.danger} />
          </View>
          <Headline>{d.approved ? 'Approved' : 'Declined'}</Headline>
          <Body muted style={{ textAlign: 'center' }}>
            {d.approved ? approvedText(d.agent.name, a, d.paused) : declinedText(d.agent.name, a)}
          </Body>
        </View>
        <Card white>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Face agent={d.agent} size={30} />
            <Body style={{ flex: 1, fontFamily: fonts.uiBold }}>{subject(a)}</Body>
            <MoneyLabel capability={d.capability} />
          </View>
          <Amount large={large} small={small ? `${small} for its rules` : null} size={30} />
          <Facts
            rows={
              d.approved
                ? [
                    d.signed ? ['Signed with', signedWith] : null,
                    a.paid_from ? [a.paid_from.kind === 'marketplace_bill' ? 'Charged to' : 'Paid from', a.paid_from.name] : null,
                    left != null ? ['Budget left once it goes through', formatLXC(left, peg)] : null,
                  ]
                : [d.signed ? ['Declined with', signedWith] : null, left != null ? [`${d.agent.name}’s budget left`, formatLXC(left + a.amount_ulxc, peg)] : null]
            }
          />
        </Card>
        <Button primary label="Done" onPress={onDone} />
        {d.next ? <Button variant="secondary" label={`Next: ${d.next.title}`} onPress={() => onNext(d.next!.id)} /> : null}
      </ScrollView>
    </SafeAreaView>
  )
}

/** When a decided approval was decided: an expired one nobody answered, when it expired (B57.68). */
const decidedOn = (a: AgentApproval) => onDay(a.decided_at ?? a.expires_at ?? a.created_at)

/** B57.68 — what was decided: `Research · Acme Hosting`, how it ended and when, the amount dollars first; each row opens
 * the approval's own screen. */
export function DecidedApprovals({ decided, agents }: { decided: AgentApproval[]; agents: readonly Who[] }) {
  const { peg } = useSession()
  const { c } = useTheme()
  if (!decided.length) return null
  return (
    <Card white>
      <Eyebrow>Decided</Eyebrow>
      <View>
        {decided.map((a, i) => {
          const { large, small } = amountParts(a, peg)
          return (
            <Row
              key={a.id}
              first={i === 0}
              title={`${agentOf(agents, a.agent_id).name} · ${subject(a)}`}
              sub={`${decidedWords(a)} · ${decidedOn(a)}`}
              right={
                <View accessible accessibilityLabel={small ? `${large} (${small})` : large} style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: fonts.display, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{large}</Text>
                  {small ? <Text style={{ fontFamily: fonts.uiMedium, fontSize: 12.5, color: c.ink3, fontVariant: ['tabular-nums'] }}>{small}</Text> : null}
                </View>
              }
              onPress={() => router.push({ pathname: '/approvals/[id]', params: { id: a.id } })}
            />
          )
        })}
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

/** B57.78 — a decided request where its notification lands, as Pocket's p-approval-landing draws it: what it was and how
 * it ended, then why nothing opens here, with the way to Approvals. */
export function DecidedCard({ approval: a, agentName }: { approval: AgentApproval; agentName: string }) {
  const { peg } = useSession()
  const { c } = useTheme()
  const what = whatItWas(a, agentName, peg)
  return (
    <>
      <Card white>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{`${subject(a)} · ${amountParts(a, peg).large}`}</Text>
          <Chip>{decidedWords(a)}</Chip>
        </View>
        {what ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink2 }}>{what}</Text> : null}
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>{`${endedWords(a)} Nothing is waiting for you here.`}</Text>
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

/** The requests waiting for the owner, each a row with Review; Review opens the sheet over the screen, and deciding shows
 * the result screen in the same window, so one closing never races the other opening. `focus` shows only that request's
 * row and opens its sheet, for the screen a notification lands on. */
export function PendingApprovals({
  pending,
  agents,
  allPaused,
  focus,
  labels = true,
  onDecided,
}: {
  pending: AgentApproval[]
  agents: readonly Who[]
  allPaused: boolean
  focus?: string
  /** each row's own Live or Sandbox; Approvals draws one for the screen instead (B57.68) */
  labels?: boolean
  onDecided: () => void
}) {
  const { c } = useTheme()
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
            <Sheet>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={close} style={{ alignSelf: 'flex-end' }}>
                <Icon name="x" color={c.ink2} />
              </Pressable>
              <ApprovalSheet
                key={sheet.id}
                approval={sheet}
                agent={agentOf(agents, sheet.agent_id)}
                capability={capabilityOf(sheet)}
                paused={allPaused || !!agentOf(agents, sheet.agent_id).paused_at}
                onApprovals={() => {
                  close()
                  router.push('/approvals')
                }}
                onDecided={(approved, signed) => {
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
                  })
                  setOpen(null)
                  onDecided()
                }}
              />
            </Sheet>
          </View>
        ) : null}
      </Modal>
    </>
  )
}
