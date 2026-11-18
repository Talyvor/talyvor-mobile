import { formatLXC, formatMinor, type ApprovalKey, type PaymentProof, type ProofPayment } from '@talyvor/bff-client'
import * as Clipboard from 'expo-clipboard'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { when } from '../activity'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { Facts, TaskSays, type Fact } from './approval-card'
import { moneyParts } from './money'
import { Body, Button, useLoad } from './ui'

// B62.4 — a payment's proof on the phone, the web's B62.3 in the phone's own layout, from Lens B62.1's record: what the
// owner approved (the payee and the amount), when, with which key, the rule that asked them or let it pass, and what was
// sent. The agent's task sits above it in its own words, always after "The agent says:" (Lens B62.2), never as a fact.
// One button copies the proof as text, for a dispute.

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

/**
 * The proof of one payment, by its money entry, drawn, with the agent's task above it (`task`, the screen's; else the
 * record's); nothing but the task for a payment the rules never judged.
 */
export function PaymentProofSection({ entry, task }: { entry: string; task?: string }) {
  const { client, peg } = useSession()
  const { c } = useTheme()
  const [copied, setCopied] = useState<string | null>(null)
  const load = useCallback(async () => {
    const proof = await client.paymentProof(entry)
    // The key's name only when one signed: a phone's or a passkey's, as Settings lists them.
    const keys = proof?.key_kind === 'device' || proof?.key_kind === 'passkey' ? await client.approvalKeys().catch(() => []) : []
    return { proof, keys }
  }, [client, entry])
  const { data, error } = useLoad(load)
  if (error) return <Body muted>We couldn’t read this payment’s proof. Try again in a moment.</Body>
  if (!data) return null
  const p = data.proof
  const says = task || p?.sent.task
  if (!p) return <TaskSays task={says} />
  const facts = proofFacts(p, data.keys, peg)
  const copy = () =>
    void Clipboard.setStringAsync(proofText(p, facts, says)).then(
      () => setCopied('Proof copied'),
      () => setCopied('We couldn’t copy it. Try again in a moment.'),
    )
  return (
    <View testID="payment-proof" style={{ gap: 10 }}>
      <TaskSays task={says} />
      <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 18, color: c.ink }}>
        Proof
      </Text>
      <Facts testID="proof-facts" rows={facts} />
      {p.key_kind ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>{p.verified ? SIGNATURE_CHECKS : SIGNATURE_FAILS}</Text> : null}
      <Button variant="secondary" icon="copy" label="Copy the proof" onPress={copy} />
      {copied ? <Body muted>{copied}</Body> : null}
    </View>
  )
}
