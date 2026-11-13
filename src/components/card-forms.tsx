import { BffError, parseLXC, refusalText, rulesInWords, type Agent, type AgentRules, type BffClient, type Cardholder } from '@talyvor/bff-client'
import { useState } from 'react'
import { View } from 'react-native'

import { biometricName, keyGone, keyGoneText, phoneKey, signWithThisPhone } from '@/keys'

import { Body, Button, Card, Eyebrow, Field } from './ui'

// B59.44 — changing a card's limits, and issuing an agent a card, on the phone's Cards, in the web's words (AgentBank.tsx
// RulesForm and useRulesChange, AgentCardPanel.tsx IssueCard). Tightening is saved at once; a change that loosens the
// rules says what it loosens, then is saved signed with the phone's key over the challenge Lens gives for exactly that
// change, as the web's Save rules is with a passkey. Lens refuses a looser save it was not given a signature for.

/** The limits the web's Rules form edits, by its labels. */
const LIMITS = [
  ['max_per_request_ulxc', 'Limit per request'],
  ['hourly_limit_ulxc', 'Hourly limit'],
  ['daily_limit_ulxc', 'Daily limit'],
  ['weekly_limit_ulxc', 'Weekly limit'],
  ['monthly_limit_ulxc', 'Monthly limit'],
  ['approval_above_ulxc', 'Ask a person above'],
] as const

type LimitField = (typeof LIMITS)[number][0]

/** 25,000,000 µLXC → `25`; no limit → empty. */
const limitText = (micros: number | undefined) => (micros && micros > 0 ? String(micros / 1_000_000) : '')

/** The rules as read with only the limits changed: every other rule, the ones the phone does not draw included, is sent
 * back as it was, since a save replaces the rules whole. */
function withLimits(rules: AgentRules, typed: Record<LimitField, string>): AgentRules {
  const out: AgentRules = { ...rules }
  for (const [f] of LIMITS) {
    const value = parseLXC(typed[f]) ?? 0
    if (value !== (rules[f] ?? 0)) out[f] = value
  }
  return out
}

/** The card's limits as sentences, and Change limits: the web's six limits in LXC, saved as the web's Save rules is. */
export function CardLimits({ client, agent, rules, peg, onSaved }: { client: BffClient; agent: Agent; rules: AgentRules; peg: number | null; onSaved: () => void }) {
  const [typed, setTyped] = useState<Record<LimitField, string> | null>(null)
  // What Lens said the change last asked about loosens, while it is still the change on the form.
  const [judged, setJudged] = useState<{ change: string; changes: string[] } | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const open = () => {
    setTyped(Object.fromEntries(LIMITS.map(([f]) => [f, limitText(rules[f])])) as Record<LimitField, string>)
    setJudged(null)
    setSaid(null)
  }
  const bad = typed !== null && LIMITS.some(([f]) => typed[f].trim() !== '' && parseLXC(typed[f]) === null)
  const proposed = typed && !bad ? withLimits(rules, typed) : null
  const shown = proposed && judged?.change === JSON.stringify(proposed) ? judged : null

  const save = async () => {
    if (!proposed) return
    setBusy(true)
    setSaid(null)
    try {
      // A fresh challenge every time: one judged earlier may have run out, and Lens signs over exactly this change.
      const [j, key] = await Promise.all([client.rulesChallenge(agent.id, proposed), phoneKey(client)])
      let assertion
      if (j.looser && j.challenge && key?.here) {
        if (!shown) return setJudged({ change: JSON.stringify(proposed), changes: j.changes ?? [] })
        assertion = await signWithThisPhone(client, j.challenge, `Loosen ${agent.name}’s rules`)
      }
      await client.setRules(agent.id, proposed, assertion)
      setTyped(null)
      setJudged(null)
      setSaid('Saved. Lens applies these rules to the next request or payment.')
      onSaved()
    } catch (err) {
      if (keyGone(err)) setSaid(keyGoneText)
      else if (err instanceof BffError && err.status === 403) setSaid(`Loosen ${agent.name}’s rules with ${biometricName} on this phone: turn approving on in Approvals first.`)
      else if (err instanceof BffError) setSaid(refusalText(err))
      else setSaid('Cancelled. Nothing changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card white>
      <Eyebrow>Limits</Eyebrow>
      <Body muted>Each purchase is paid from its wallet only if its rules allow it.</Body>
      {typed === null ? (
        <>
          {rulesInWords(rules, peg).map((r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
              <Body>•</Body>
              <Body style={{ flex: 1 }}>{r}</Body>
            </View>
          ))}
          <Button label="Change limits" accessibilityLabel={`Change ${agent.name}’s limits`} onPress={open} />
        </>
      ) : (
        <>
          <Body muted>LXC; empty for no limit</Body>
          {LIMITS.map(([f, label]) => (
            <Field
              key={f}
              label={label}
              accessibilityLabel={`${label} for ${agent.name}, in LXC`}
              inputMode="decimal"
              placeholder="No limit"
              value={typed[f]}
              onChangeText={(t) => setTyped({ ...typed, [f]: t })}
            />
          ))}
          {bad ? <Body>A limit is an amount of LXC with at most six decimals, or empty.</Body> : null}
          {shown ? (
            <View style={{ gap: 4 }}>
              <Body>This loosens {agent.name}’s rules:</Body>
              {shown.changes.map((c) => (
                <View key={c} style={{ flexDirection: 'row', gap: 8 }}>
                  <Body>•</Body>
                  <Body style={{ flex: 1 }}>{c}</Body>
                </View>
              ))}
              <Body muted>It needs {biometricName}. Tightening is saved at once.</Body>
            </View>
          ) : null}
          <Button primary label={busy ? 'Saving…' : shown ? `Save with ${biometricName}` : 'Save rules'} disabled={bad || busy} onPress={() => void save()} />
          <Button variant="ghost" label="Cancel" disabled={busy} onPress={() => setTyped(null)} />
        </>
      )}
      {said ? (
        <View accessibilityRole="alert">
          <Body>{said}</Body>
        </View>
      ) : null}
    </Card>
  )
}

/** B27.21 — the cardholder's phone as the issuer takes it, E.164: "+44 7700 900123" → "+447700900123". Empty stays empty;
 * null when what was typed is not a phone number. */
export function e164(text: string): string | null {
  const compact = text.replace(/[\s().-]/g, '')
  if (compact === '') return ''
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null
}

const FIELDS: { key: keyof Cardholder; label: string; required: boolean; auto: 'given-name' | 'family-name' | 'email' | 'tel' | 'address-line1' | 'address-line2' | 'postal-address-locality' | 'postal-code' | 'country' }[] = [
  { key: 'first_name', label: 'First name', required: true, auto: 'given-name' },
  { key: 'last_name', label: 'Last name', required: true, auto: 'family-name' },
  { key: 'email', label: 'Email', required: false, auto: 'email' },
  { key: 'phone_number', label: 'Phone', required: false, auto: 'tel' },
  { key: 'line1', label: 'Address', required: true, auto: 'address-line1' },
  { key: 'line2', label: 'Address line 2', required: false, auto: 'address-line2' },
  { key: 'city', label: 'Town or city', required: true, auto: 'postal-address-locality' },
  { key: 'postal_code', label: 'Postcode', required: true, auto: 'postal-code' },
  { key: 'country', label: 'Country (two letters)', required: false, auto: 'country' },
]

const EMPTY: Cardholder = { first_name: '', last_name: '', email: '', phone_number: '', line1: '', line2: '', city: '', postal_code: '', country: 'GB' }

/** The web's cardholder form: the person the agent's virtual card is issued to. */
export function IssueCard({ client, agent, onIssued }: { client: BffClient; agent: Agent; onIssued: () => void }) {
  const [holder, setHolder] = useState<Cardholder>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const phone = e164(holder.phone_number)
  const ready = FIELDS.every((f) => !f.required || holder[f.key].trim() !== '') && phone !== null

  const issue = async () => {
    setBusy(true)
    setRefused(null)
    try {
      await client.issueCard(agent.id, { ...holder, phone_number: phone ?? '' })
      onIssued()
    } catch (err) {
      setRefused(refusalText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: 12 }} testID={`issue-card-${agent.id}`}>
      <Body muted>
        Give {agent.name} a virtual card. Each purchase is paid from its wallet only if its rules allow it, converted from pounds at the day’s European Central Bank
        rate. Stripe issues the card to a person (the cardholder), and a merchant may ask for their billing address. Their phone number is optional.
      </Body>
      {FIELDS.map((f) => (
        <Field
          key={f.key}
          label={f.required ? f.label : `${f.label} (optional)`}
          autoComplete={f.auto}
          inputMode={f.key === 'phone_number' ? 'tel' : f.key === 'email' ? 'email' : undefined}
          value={holder[f.key]}
          onChangeText={(t) => setHolder((h) => ({ ...h, [f.key]: t }))}
        />
      ))}
      {phone === null ? <Body>The phone number needs its country code, like +44 7700 900123.</Body> : null}
      <Button primary label={busy ? 'Issuing…' : 'Issue a card'} accessibilityLabel="Issue a card" disabled={!ready || busy} onPress={() => void issue()} />
      {refused ? (
        <View accessibilityRole="alert">
          <Body>{refused}</Body>
        </View>
      ) : null}
    </View>
  )
}
