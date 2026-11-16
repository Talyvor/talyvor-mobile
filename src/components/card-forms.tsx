import {
  BffError,
  CURRENCY_WORDS,
  agentCurrency,
  convertDown,
  formatMinor,
  heldIn,
  heldMinor,
  parseRuleAmount,
  refusalText,
  ruleAmountText,
  rulesInWords,
  rulesSave,
  type Agent,
  type AgentRules,
  type BffClient,
  type Cardholder,
  type FXRates,
  type MinorLimit,
} from '@talyvor/bff-client'
import { useState, type ReactNode } from 'react'
import { Text, TextInput, View, type TextInputProps } from 'react-native'

import { biometricName, keyGone, keyGoneText, phoneKey, signWithThisPhone } from '@/keys'

import { Icon } from './icon'
import { Body, Button, Card, Eyebrow } from './ui'
import { fonts, useTheme } from '../theme'

// B59.44 — changing a card's limits, and issuing an agent a card, on the phone's Cards, in the web's words (AgentBank.tsx
// RulesForm and useRulesChange, AgentCardPanel.tsx IssueCard). Tightening is saved at once; a change that loosens the
// rules says what it loosens, then is saved signed with the phone's key over the challenge Lens gives for exactly that
// change, as the web's Save rules is with a passkey. Lens refuses a looser save it was not given a signature for.
// B57.160 — in Pocket, as the reference's rules draw a list of settings (.li.rulerow): each limit is a row with its name
// over what it is now and its amount on the right; what a looser change loosens is said in the warning note with the
// key; and the cardholder form is a list of the same rows in one panel.

/** A setting's row: its name, and what it is now under it, beside its input. A rule above every row but the first. */
function SettingRow({ title, sub, unit, first, testID, inputWidth, ...input }: { title: string; sub?: string; unit?: string; first?: boolean; testID?: string; inputWidth: number } & Omit<TextInputProps, 'style'>) {
  const { c } = useTheme()
  return (
    <View testID={testID} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }, !first && { borderTopWidth: 1, borderTopColor: c.line }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontFamily: fonts.uiMedium, fontSize: 14, lineHeight: 19, color: c.ink }}>{title}</Text>
        {sub ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: c.ink3 }}>{sub}</Text> : null}
      </View>
      <TextInput
        accessibilityLabel={title}
        placeholderTextColor={c.ink3}
        style={{
          width: inputWidth,
          height: 46,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: c.control,
          backgroundColor: c.page,
          paddingHorizontal: 12,
          color: c.ink,
          fontFamily: fonts.ui,
          fontSize: 14,
          textAlign: unit ? 'right' : 'left',
          fontVariant: unit ? ['tabular-nums'] : undefined,
        }}
        {...input}
      />
      {unit ? <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }}>{unit}</Text> : null}
    </View>
  )
}

/** Pocket's warning note (.note2.warnnote), with the key a looser change is signed with. */
function LoosensNote({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return (
    <View testID="loosens-note" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.tangerine50 }}>
      <View style={{ marginTop: 1 }}>
        <Icon name="key" size={16} color={c.tangerineInk} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>{children}</View>
    </View>
  )
}

/** The limits the web's Rules form edits, by its labels. */
const LIMITS = [
  ['max_per_payment_minor', 'Limit per request'],
  ['hourly_limit_minor', 'Hourly limit'],
  ['daily_limit_minor', 'Daily limit'],
  ['weekly_limit_minor', 'Weekly limit'],
  ['monthly_limit_minor', 'Monthly limit'],
  ['approval_above_minor', 'Ask a person above'],
] as const satisfies readonly (readonly [MinorLimit, string])[]

/** The form as opened: the currency its limits are typed in, each limit as text in it, and — when the rules are held
 * in another currency — each limit as held there. */
type Opened = { currency: string; typed: Record<MinorLimit, string>; converted: { from: string; minor: Record<MinorLimit, number> } | null }

/** B61.88 — the form for rules in the account's currency: each limit converted at the day's rates, rounded down, when the
 * rules are held in another (Lens B61.12); null while a rate it needs is unread. */
function openIn(rules: AgentRules, peg: number, currency: string, fx: FXRates | null): Opened | null {
  const from = heldIn(rules)
  const held = Object.fromEntries(LIMITS.map(([f]) => [f, heldMinor(rules, f, peg)])) as Record<MinorLimit, number>
  const typed = {} as Record<MinorLimit, string>
  for (const [f] of LIMITS) {
    const v = convertDown(held[f], from, currency, fx)
    if (v === null) return null
    typed[f] = ruleAmountText(v, currency)
  }
  return { currency, typed, converted: from === currency ? null : { from, minor: held } }
}

/** The card's limits as sentences, and Change limits: the web's six limits in the account's currency, saved as the web's
 * Save rules is — the currency and every limit in its minor units, and no µLXC limit. */
export function CardLimits({ client, agent, rules, peg, onSaved }: { client: BffClient; agent: Agent; rules: AgentRules; peg: number | null; onSaved: () => void }) {
  const [form, setForm] = useState<Opened | null>(null)
  // What Lens said the change last asked about loosens, while it is still the change on the form.
  const [judged, setJudged] = useState<{ change: string; changes: string[] } | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const currency = agentCurrency(agent) ?? heldIn(rules)
  const words = CURRENCY_WORDS[currency] ?? currency

  const open = async () => {
    if (!peg) return
    setJudged(null)
    setSaid(null)
    // The day's rates are read only when the rules are held in a currency a rate is needed from.
    let fx: FXRates | null = null
    if (convertDown(1, heldIn(rules), currency, null) === null) {
      setBusy(true)
      fx = await client.fx().catch(() => null)
      setBusy(false)
    }
    const opened = openIn(rules, peg, currency, fx)
    if (!opened) return setSaid(`${agent.name}’s rules are held in ${CURRENCY_WORDS[heldIn(rules)]}, and today’s rate to ${words} could not be read just now. Nothing changed.`)
    setForm(opened)
  }
  const typed = form?.typed ?? null
  const bad = typed !== null && LIMITS.some(([f]) => parseRuleAmount(typed[f], currency) === null)
  const proposed =
    form && !bad && peg ? rulesSave(rules, peg, currency, Object.fromEntries(LIMITS.map(([f]) => [f, parseRuleAmount(form.typed[f], currency) ?? 0])) as Record<MinorLimit, number>) : null
  const shown = proposed && judged?.change === JSON.stringify(proposed) ? judged : null
  const held = (f: MinorLimit) => {
    const v = peg ? heldMinor(rules, f, peg) : 0
    if (!(v > 0)) return 'No limit'
    return form?.converted ? `Held at ${formatMinor(v, form.converted.from)}, rounded down at today’s rate` : formatMinor(v, heldIn(rules))
  }

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
      setForm(null)
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
      {form === null || typed === null ? (
        <>
          {rulesInWords(rules, peg).map((r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
              <Body>•</Body>
              <Body style={{ flex: 1 }}>{r}</Body>
            </View>
          ))}
          {/* Until the peg is read, a limit Lens holds without a currency cannot be counted, so the limits are not opened. */}
          <Button label="Change limits" accessibilityLabel={`Change ${agent.name}’s limits`} disabled={!peg || busy} onPress={() => void open()} />
        </>
      ) : (
        <>
          {form.converted ? (
            <View testID="rules-currency">
              <Body>{`${agent.name}’s rules are still held in ${CURRENCY_WORDS[form.converted.from]}. Each limit below is in ${words} at today’s rate, rounded down: check them, then save to hold the rules in ${words}.`}</Body>
            </View>
          ) : null}
          <Body muted>{`${words.charAt(0).toUpperCase()}${words.slice(1)}; empty for no limit`}</Body>
          <View>
            {LIMITS.map(([f, label], i) => (
              <SettingRow
                key={f}
                testID={`limit-row-${f}`}
                first={i === 0}
                title={label}
                sub={held(f)}
                unit={currency}
                inputWidth={112}
                accessibilityLabel={`${label} for ${agent.name}, in ${words}`}
                inputMode="decimal"
                placeholder="No limit"
                value={typed[f]}
                onChangeText={(t) => setForm({ ...form, typed: { ...typed, [f]: t } })}
              />
            ))}
          </View>
          {bad ? <Body>{`A limit is an amount in ${words}, or empty.`}</Body> : null}
          {shown ? <Loosens name={agent.name} changes={shown.changes} /> : null}
          <Button primary label={busy ? 'Saving…' : shown ? `Save with ${biometricName}` : 'Save rules'} disabled={bad || busy} onPress={() => void save()} />
          <Button variant="ghost" label="Cancel" disabled={busy} onPress={() => setForm(null)} />
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

/** What a looser change loosens, in the warning note. */
function Loosens({ name, changes }: { name: string; changes: string[] }) {
  const { c } = useTheme()
  const tone = { color: c.tangerineInk, fontSize: 13.5, lineHeight: 19 }
  return (
    <LoosensNote>
      <Body style={tone}>This loosens {name}’s rules:</Body>
      {changes.map((line) => (
        <View key={line} style={{ flexDirection: 'row', gap: 8 }}>
          <Body style={tone}>•</Body>
          <Body style={{ ...tone, flex: 1 }}>{line}</Body>
        </View>
      ))}
      <Body style={tone}>It needs {biometricName}. Tightening is saved at once.</Body>
    </LoosensNote>
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
      <View testID={`cardholder-${agent.id}`}>
        <Card white>
          <View>
            {FIELDS.map((f, i) => (
              <SettingRow
                key={f.key}
                testID={`holder-row-${f.key}`}
                first={i === 0}
                title={f.required ? f.label : `${f.label} (optional)`}
                inputWidth={164}
                autoComplete={f.auto}
                inputMode={f.key === 'phone_number' ? 'tel' : f.key === 'email' ? 'email' : undefined}
                value={holder[f.key]}
                onChangeText={(t) => setHolder((h) => ({ ...h, [f.key]: t }))}
              />
            ))}
          </View>
        </Card>
      </View>
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
