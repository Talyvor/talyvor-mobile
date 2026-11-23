import { formatLXC, formatMinor, type ApprovalKey, type PaymentProof, type ProofPayment, type SpendPayment } from '@talyvor/bff-client'
import * as Clipboard from 'expo-clipboard'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { when } from '../activity'
import { useSession } from '../session'
import { categoryName } from '../spending'
import { fonts, useTheme } from '../theme'
import { Facts, TaskSays, type Fact } from './approval-card'
import { Icon } from './icon'
import { Money, moneyParts } from './money'
import { Body, Button, Card, Chip, useLoad } from './ui'

// B62.4 — a payment's proof on the phone, the web's B62.3 in the phone's own layout, from Lens B62.1's record: what the
// owner approved (the payee and the amount), when, with which key, the rule that asked them or let it pass, and what was
// sent. The agent's task sits above it in its own words, always after "The agent says:" (Lens B62.2), never as a fact.
// One button copies the proof as text, for a dispute.
// B57.191 — drawn in Pocket as the web's B57.190: the payment as the P10 receipt, the task under who it was paid to, the
// Proof a cloud section of its own with the verdict's mark.

/** The rule that sent a payment to the owner, or let it pass, in words: the web's PROOF_RULE. */
export const PROOF_RULE: Record<string, string> = {
  approval_above: 'It was above the amount the agent’s rules ask you about',
  prepared: 'An assistant prepared it, so it waited for you',
  within_rules: 'Inside the agent’s rules, so it needed no approval',
  always_allow: 'You always allow this payee',
  mandate: 'Within a mandate you signed in advance',
  no_rules: 'The agent has no rules, so it needed no approval',
}

/** The key that signed, in words: "Face ID on Nick’s iPhone", "Passkey on MacBook Pro". */
export function proofKeyWords(p: Pick<PaymentProof, 'key_kind' | 'key_id'>, keys: readonly ApprovalKey[]): string {
  switch (p.key_kind) {
    case 'device': {
      const d = keys.find((k) => k.kind === 'phone' && k.id === p.key_id)
      return `${d?.platform === 'android' ? 'Fingerprint' : 'Face ID'} on ${d?.name || 'your phone'}`
    }
    case 'passkey': {
      const k = keys.find((x) => x.kind === 'passkey' && x.id === p.key_id)
      return k?.name ? `Passkey on ${k.name}` : 'Your passkey'
    }
    case 'approver_agent':
      return 'Your approver agent, within the limits you gave it'
  }
  return ''
}

/** "$34.00 to Acme Hosting": one side of the proof. */
function paidTo(p: ProofPayment, peg: number | null) {
  const written = p.currency === 'LXC' ? formatLXC(p.amount_minor, peg) : formatMinor(p.amount_minor, p.currency)
  return `${moneyParts(written).large} to ${p.payee.name || 'the payee'}`
}

export const SIGNATURE_CHECKS = 'The signature checks out: it is by this key, over exactly what you approved.'
export const SIGNATURE_FAILS = 'The signature does not check out against what you approved.'

/** The proof's facts, in order: an approved payment's five, or a payment the rules passed's three, with no key. */
export function proofFacts(p: PaymentProof, keys: readonly ApprovalKey[], peg: number | null): Fact[] {
  const rule = `${PROOF_RULE[p.rule] ?? 'The agent’s rules'}${p.rules_version != null ? ` (rules version ${p.rules_version})` : ''}`
  if (!p.key_kind)
    return [
      ['The rule', rule],
      ['When', when(p.created_at)],
      ['What was sent', paidTo(p.sent, peg)],
    ]
  return [
    ['You approved', paidTo(p.shown, peg)],
    ['When', when(p.signed_at ?? p.created_at)],
    ['Signed with', proofKeyWords(p, keys) || 'Your key'],
    ['The rule', rule],
    ['What was sent', paidTo(p.sent, peg)],
  ]
}

/** The proof as text, for a dispute: what the screen shows, line by line, under "Payment proof". */
export function proofText(p: PaymentProof, facts: readonly Fact[], task?: string): string {
  return [
    'Payment proof',
    ...(task ? [`The agent says: “${task}”`] : []),
    ...facts.map(([label, value]) => `${label}: ${value}`),
    ...(p.key_kind ? [p.verified ? SIGNATURE_CHECKS : SIGNATURE_FAILS] : []),
  ].join('\n')
}

/** A payment's notice's proof (B62.4): the agent's task, then the Proof section, under the notice's own card (p-notice).
 * B62.11: a used approval's too, its `entry` the approval's id. */
export function PaymentProofSection({ entry }: { entry: string }) {
  const read = usePaymentProof(entry)
  const task = read.data?.proof?.sent.task
  return (
    <View style={{ gap: 10 }}>
      <TaskSays task={task} />
      <ProofSection read={read} task={task} />
    </View>
  )
}

/** The read of a payment's proof by its money entry, with the key that signed it: its receipt starts it, so the task it
 * recorded can sit under who it was paid to while the proof is drawn below. */
export function usePaymentProof(entry: string) {
  const { client } = useSession()
  const load = useCallback(async () => {
    const proof = await client.paymentProof(entry)
    // The key's name only when one signed: a phone's or a passkey's, as Settings lists them.
    const keys = proof?.key_kind === 'device' || proof?.key_kind === 'passkey' ? await client.approvalKeys().catch(() => []) : []
    return { proof, keys }
  }, [client, entry])
  return useLoad(load)
}

type ProofRead = ReturnType<typeof usePaymentProof>

/**
 * B57.191 — a payment drawn as the launch pack's P10 receipt, as the web's B57.190 draws its page: its state, the amount
 * large, who it was paid to with the agent's task under it, its facts, then its Proof. `whose` is the wallet it was paid
 * from, in words.
 */
export function PaymentReceipt({ payment: p, whose }: { payment: SpendPayment; whose: string }) {
  const read = usePaymentProof(p.entry_id)
  return (
    <Card white>
      <View testID="payment-receipt" style={{ gap: 14 }}>
        {p.kind === 'pay' ? (
          <View style={{ flexDirection: 'row' }}>
            <Chip>Paid</Chip>
          </View>
        ) : null}
        <View style={{ gap: 4 }}>
          <Money minor={p.amount_minor} currency={p.currency} size={44} />
          <Body>
            <Text testID="payment-to">
              {'to '}
              <Text style={{ fontFamily: fonts.uiBold }}>{p.merchant || 'the payee'}</Text>
            </Text>
          </Body>
          <TaskSays task={read.data?.proof?.sent.task} />
        </View>
        <Facts
          testID="payment-facts"
          rows={[
            ['What', categoryName(p.category)],
            ['Account', whose],
            ['When', when(p.created_at)],
          ]}
        />
        <ProofSection read={read} task={read.data?.proof?.sent.task} />
      </View>
    </Card>
  )
}

/**
 * The proof of one payment, drawn as the P10 receipt draws a section of its own: a cloud plane with its heading inside,
 * the facts on the page plane, and the signature's verdict with its mark (a tick when it checks out, a cross when not).
 * Its copy starts with the agent's task (`task`). Nothing for a payment the rules never judged.
 */
function ProofSection({ read, task }: { read: ProofRead; task?: string }) {
  const { peg } = useSession()
  const { c } = useTheme()
  const [copied, setCopied] = useState<string | null>(null)
  const { data, error } = read
  if (error) return <Body muted>We couldn’t read this payment’s proof. Try again in a moment.</Body>
  const p = data?.proof
  if (!data || !p) return null
  const facts = proofFacts(p, data.keys, peg)
  const copy = () =>
    void Clipboard.setStringAsync(proofText(p, facts, task)).then(
      () => setCopied('Proof copied'),
      () => setCopied('We couldn’t copy it. Try again in a moment.'),
    )
  return (
    <View testID="payment-proof" style={{ gap: 12, padding: 16, borderRadius: 16, backgroundColor: c.cloud }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 20, color: c.ink }}>
        Proof
      </Text>
      <Facts testID="proof-facts" on="cloud" rows={facts} />
      {p.key_kind ? (
        <View testID="proof-verdict" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ marginTop: 1 }}>
            <Icon name={p.verified ? 'check' : 'x'} size={18} color={p.verified ? c.success : c.danger} />
          </View>
          <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, lineHeight: 21, color: p.verified ? c.ink2 : c.danger }}>
            {p.verified ? SIGNATURE_CHECKS : SIGNATURE_FAILS}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row' }}>
        <Button small variant="secondary" icon="copy" label="Copy the proof" onPress={copy} />
      </View>
      {copied ? <Body muted>{copied}</Body> : null}
    </View>
  )
}
