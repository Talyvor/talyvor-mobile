import { type Agent, BffError, CURRENCY_WORDS, formatMinor, merchantCategoriesText, parseRuleAmount, refusalText } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { type ReactNode, useCallback, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { useAccount } from '@/account'
import { AGENT_KINDS, type AgentKindChoice, newAgentRules, RULE_FIELDS, type RuleKey } from '@/agent-kinds'
import { AGENT_PICTURES, type AgentPicture, lookFor } from '@/agent-pictures'
import { Face } from '@/components/face'
import { HOME_MONEY } from '@/components/home'
import { Icon } from '@/components/icon'
import { MerchantChoices } from '@/components/merchant-categories'
import { MoneyLabel } from '@/components/money-label'
import { BottomSheet } from '@/components/pay-sheet'
import { Press } from '@/components/press'
import { Body, Button, Card, Field, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { biometricName, keyGone, keyGoneText, phoneKey, signWithThisPhone } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.37 — New agent on the phone, as the web's (talyvor-suite B61.13), in Pocket Live's three steps (`na` 0 to 2): one
// of Talyvor's six, named by what it does, or your own; then the name the owner types (a helper's name is never offered),
// with the picture and what it does for your own; then the four rules in the account's currency, the six's suggested
// amounts filled in and each changeable. Create makes the agent, saves what it does and its rules, and opens its page.
// A save Lens judges looser is signed with this phone's key, as every rules save on the phone is (B59.44).
// B57.178 — as Pocket Live draws it: the back arrow alone, three step bars without words, the pictures at 56, and the
// limits as a card of rows, each its amount in the account's currency, opening its own sheet (ruleEdit) to change it.
// B61.103 — your own picks from the web's gallery of 27: the six's faces, lime's, and the twenty drawn ones (B61.36).
// B61.120 — under the limits, Merchants and categories as the web's More rules draws it (B61.64): any merchant until some
// are picked, then only those, by card.

const FIAT_ORDER = ['USD', 'EUR', 'GBP']
const STEPS = 3

type Start = AgentKindChoice | 'own'
type Typed = Record<RuleKey, string>
const NOTHING_TYPED: Typed = { perPayment: '', perDay: '', perMonth: '', askAbove: '' }
const typedFrom = (r: Record<RuleKey, number>): Typed => ({
  perPayment: r.perPayment > 0 ? String(r.perPayment) : '',
  perDay: r.perDay > 0 ? String(r.perDay) : '',
  perMonth: r.perMonth > 0 ? String(r.perMonth) : '',
  askAbove: r.askAbove > 0 ? String(r.askAbove) : '',
})

/** Each typed amount in currency's minor units, 0 for one left empty; null while any is not an amount in it. */
function minorOf(typed: Typed, currency: string): Record<RuleKey, number> | null {
  const out = { perPayment: 0, perDay: 0, perMonth: 0, askAbove: 0 }
  for (const [key] of RULE_FIELDS) {
    const minor = parseRuleAmount(typed[key], currency)
    if (minor === null) return null
    out[key] = minor
  }
  return out
}

/** A bar a step across the width, tangerine when reached; "Step n of 3" is said, not shown (Pocket Live's .steps). */
function Steps({ at }: { at: number }) {
  const { c } = useTheme()
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Step ${at} of ${STEPS}`} style={{ flexDirection: 'row', gap: 5, paddingTop: 6, paddingHorizontal: 2 }}>
      {Array.from({ length: STEPS }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 5, borderRadius: 999, backgroundColor: i < at ? c.tangerine : c.cloud2 }} />
      ))}
    </View>
  )
}

/** A picture as the agent will be drawn: its colour's face, or the drawn picture it is. */
const drawn = (p: AgentPicture, name: string, size: number) => <Face agent={{ id: `new-${p.id}`, name, colour: p.colour, face: 'circle', picture: p.id }} size={size} />
const pictureOfKind = (k: AgentKindChoice) => AGENT_PICTURES.find((p) => p.id === k.colour) as AgentPicture

/** One choice of the first step: radio semantics; cloud when off, white with a 2px ink ring when on. */
function Choice({ picked, onPick, title, line, left, wide }: { picked: boolean; onPick: () => void; title: string; line: string; left: ReactNode; wide?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${title}. ${line}`}
      accessibilityState={{ checked: picked }}
      onPress={onPick}
      style={{
        width: wide ? '100%' : '48%',
        flexDirection: wide ? 'row' : 'column',
        alignItems: wide ? 'center' : 'flex-start',
        gap: wide ? 12 : 8,
        padding: 12,
        borderRadius: 16,
        backgroundColor: picked ? c.page : c.cloud,
        borderWidth: 2,
        borderColor: picked ? c.ink : 'transparent',
      }}>
      {left}
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{line}</Text>
      </View>
    </Pressable>
  )
}

export default function NewAgentScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const { shows } = useAccount(client)
  const load = useCallback(async () => (await client.moneyAccounts()).accounts ?? [], [client])
  const accounts = useLoad(load)
  // The account's own currency, as the web's (rulesCurrency.ts): USDC for a stablecoin account, else its first fiat account.
  const own = (accounts.data ?? []).filter((a) => a.purpose === 'company' && a.status !== 'closed' && FIAT_ORDER.includes(a.currency))
  const currency = shows === null || (accounts.loading && !accounts.data) ? null : !shows.bankTransfers ? 'USDC' : (own.map((a) => a.currency).sort((a, b) => FIAT_ORDER.indexOf(a) - FIAT_ORDER.indexOf(b))[0] ?? 'USD')

  const [step, setStep] = useState(0)
  const [start, setStart] = useState<Start | null>(null)
  const [name, setName] = useState('')
  const [does, setDoes] = useState('')
  const [picture, setPicture] = useState<AgentPicture>(AGENT_PICTURES[0])
  const [typed, setTyped] = useState<Typed>(NOTHING_TYPED)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [made, setMade] = useState<{ agent: Agent; unsaved: string[] } | null>(null)
  const [editing, setEditing] = useState<RuleKey | null>(null)
  const [merchants, setMerchants] = useState<string[]>([])

  const ours = start && start !== 'own' ? start : null
  const pick = (s: Start) => {
    setStart(s)
    setPicture(s === 'own' ? picture : pictureOfKind(s))
    setTyped(s === 'own' ? NOTHING_TYPED : typedFrom(s.rules))
  }
  const back = () => (step > 0 ? setStep(step - 1) : router.canGoBack() ? router.back() : router.replace('/agents'))
  const trimmed = name.trim()
  const minor = currency ? minorOf(typed, currency) : null
  const nothingTyped = RULE_FIELDS.every(([key]) => typed[key].trim() === '')
  const words = currency ? (CURRENCY_WORDS[currency] ?? currency) : ''

  const create = async () => {
    if (!currency || !minor || !trimmed) return
    setBusy(true)
    setSaid('')
    let agent: Agent
    try {
      const look = lookFor(picture)
      agent = await client.createAgent(trimmed, look.colour, currency === 'USDC' ? undefined : currency, look.picture)
    } catch (err) {
      setBusy(false)
      return setSaid(refusalText(err))
    }
    const unsaved: string[] = []
    const description = ours ? ours.kind : does.trim()
    if (description) {
      try {
        await client.describeAgent(agent.id, description)
      } catch (err) {
        unsaved.push(`what it does was not saved: ${refusalText(err)}`)
      }
    }
    const rules = newAgentRules(minor, currency, merchants)
    try {
      const [j, key] = await Promise.all([client.rulesChallenge(agent.id, rules), phoneKey(client)])
      const assertion = j.looser && j.challenge && key?.here ? await signWithThisPhone(client, j.challenge, `Set ${agent.name}’s rules`) : undefined
      await client.setRules(agent.id, rules, assertion)
    } catch (err) {
      if (keyGone(err)) unsaved.push(`its rules were not saved: ${keyGoneText}`)
      else if (err instanceof BffError && err.status === 403) unsaved.push(`its rules were not saved: set them with ${biometricName} on this phone, after turning approving on in Approvals.`)
      else if (err instanceof BffError) unsaved.push(`its rules were not saved: ${refusalText(err)}`)
      else unsaved.push('its rules were not saved: cancelled.')
    }
    setBusy(false)
    if (unsaved.length) return setMade({ agent, unsaved })
    router.replace({ pathname: '/agents/[id]', params: { id: agent.id } })
  }

  const open = (a: Agent) => router.replace({ pathname: '/agents/[id]', params: { id: a.id } })

  let body: ReactNode
  let next: ReactNode
  if (made) {
    body = (
      <Body>
        {`${made.agent.name} was created, but ${made.unsaved.join('; and ')} Set it on its page.`}
      </Body>
    )
    next = <Button primary label={`Open ${made.agent.name}`} onPress={() => open(made.agent)} />
  } else if (step === 0) {
    body = (
      <>
        <Headline>Which agent?</Headline>
        <Body muted>Pick one of ours, or make your own.</Body>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
          {AGENT_KINDS.map((k) => (
            <Choice key={k.kind} picked={ours?.kind === k.kind} onPick={() => pick(k)} title={k.kind} line={k.line} left={drawn(pictureOfKind(k), k.kind, 56)} />
          ))}
          <Choice
            wide
            picked={start === 'own'}
            onPick={() => pick('own')}
            title="Your own"
            line="You pick its name, its picture and what it does"
            left={
              <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: c.page }}>
                <Icon name="plus" size={20} color={c.ink2} />
              </View>
            }
          />
        </View>
      </>
    )
    next = <Button primary label="Continue" disabled={!start} hint="Pick one of ours, or make your own." onPress={() => setStep(1)} />
  } else if (step === 1) {
    body = (
      <>
        <Headline>{ours ? 'Name your agent' : 'Make it yours'}</Headline>
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>{drawn(picture, trimmed || 'New', 72)}</View>
        <Field label="Its name" value={name} onChangeText={setName} placeholder={`For example, ${ours ? ours.kind : 'Sidekick'}`} maxLength={24} autoCorrect={false} />
        {ours ? null : (
          <>
            <Field label="What it does" value={does} onChangeText={setDoes} placeholder="For example, Gifts" maxLength={20} autoCorrect={false} />
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: fonts.uiMedium, fontSize: 14, color: c.ink2 }}>Its picture</Text>
              <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {AGENT_PICTURES.map((p, i) => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="radio"
                    accessibilityLabel={`Picture ${i + 1}`}
                    accessibilityState={{ checked: picture.id === p.id }}
                    onPress={() => setPicture(p)}
                    style={{ padding: 3, borderRadius: 999, borderWidth: 2, borderColor: picture.id === p.id ? c.ink : 'transparent' }}>
                    {drawn(p, `Picture ${i + 1}`, 44)}
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}
      </>
    )
    next = <Button primary label="Continue" disabled={!trimmed} hint="Name it first." onPress={() => setStep(2)} />
  } else {
    body = (
      <>
        <Headline>{`Set ${trimmed}’s limits`}</Headline>
        <Body muted>{`${trimmed} pays on its own inside these. Anything outside waits for your yes.`}</Body>
        <LoadState loading={currency === null} error={accounts.error} />
        {currency ? (
          <Card>
            {RULE_FIELDS.map(([key, label], i) => {
              const amount = parseRuleAmount(typed[key], currency)
              const shown = typed[key].trim() === '' ? 'None' : amount === null ? typed[key] : formatMinor(amount, currency)
              return <RuleRow key={key} first={i === 0} label={label} amount={shown} onPress={() => setEditing(key)} />
            })}
          </Card>
        ) : null}
        {nothingTyped ? (
          <View testID="new-agent-every-payment">
            <Body>With none of these set, every payment waits for your yes.</Body>
          </View>
        ) : null}
        {currency ? (
          <View testID="new-agent-merchants" style={{ gap: 8 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>Merchants and categories</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: c.ink3 }}>
              {merchants.length > 0 ? `${merchantCategoriesText(merchants)}. Only these, by card.` : 'Any merchant. Pick some to let it pay only them by card.'}
            </Text>
            <MerchantChoices label="Merchants and categories" chosen={merchants} onChange={setMerchants} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.cloud }}>
          <Icon name="sliders" size={20} color={c.ink2} />
          <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: c.ink2 }}>You can change these any time on the agent’s page.</Text>
        </View>
        {said ? <Body style={{ color: c.danger }}>{said}</Body> : null}
        {currency && editing ? (
          <RuleSheet
            label={RULE_FIELDS.find(([key]) => key === editing)![1]}
            asks={editing === 'askAbove'}
            currency={currency}
            words={words}
            value={typed[editing]}
            onClose={() => setEditing(null)}
            onSave={(v) => {
              setTyped((t) => ({ ...t, [editing]: v }))
              setEditing(null)
            }}
          />
        ) : null}
      </>
    )
    next = <Button primary label={busy ? 'Creating…' : 'Create agent'} disabled={busy || !minor || !trimmed} hint="Creating…" onPress={() => void create()} />
  }

  return (
    <Screen footer={next}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {made ? <View /> : <BackStep onPress={back} />}
        <MoneyLabel capability={HOME_MONEY} />
      </View>
      {made ? null : <Steps at={step + 1} />}
      {body}
    </Screen>
  )
}

/** Back a step, or off New agent from its first: the arrow alone, as Pocket Live's nav draws it. */
function BackStep({ onPress }: { onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Press accessibilityRole="button" accessibilityLabel="Back" hitSlop={6} onPress={onPress} style={{ width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="back" size={22} color={c.ink} />
    </Press>
  )
}

/** One limit on the third step: its name, its amount on the right and the way into its sheet. */
function RuleRow({ label, amount, first, onPress }: { label: string; amount: string; first: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Press
      kind="row"
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${amount}`}
      onPress={onPress}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 }, !first && { borderTopWidth: 1, borderTopColor: c.line }]}>
      <Text style={{ flex: 1, fontFamily: fonts.uiMedium, fontSize: 15, color: c.ink }}>{label}</Text>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{amount}</Text>
      <Icon name="chev" size={16} color={c.ink3} />
    </Press>
  )
}

/** A limit's sheet (Pocket Live's ruleEdit): its name and the Sandbox label, the amount in the account's currency, what it
 * means, and Save. Empty is no limit; anything that is not an amount in the currency is not saved. */
function RuleSheet({ label, asks, currency, words, value, onClose, onSave }: { label: string; asks: boolean; currency: string; words: string; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const { c } = useTheme()
  const [draft, setDraft] = useState(value)
  const ok = parseRuleAmount(draft, currency) !== null
  return (
    <BottomSheet visible onClose={onClose} testID="new-agent-rule">
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Headline>{label}</Headline>
          <MoneyLabel capability={HOME_MONEY} />
        </View>
        <TextInput
          accessibilityLabel={`${label}, in ${words}`}
          value={draft}
          onChangeText={setDraft}
          placeholder="None"
          placeholderTextColor={c.ink3}
          keyboardType="decimal-pad"
          autoFocus
          style={{ fontFamily: fonts.display, fontSize: 46, color: c.ink, textAlign: 'center', paddingVertical: 6, fontVariant: ['tabular-nums'] }}
        />
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3, textAlign: 'center' }}>
          {asks ? 'A payment above this waits for your yes' : `The most it can pay ${label.toLowerCase()}`}
        </Text>
        {ok ? null : <Body style={{ color: c.danger, textAlign: 'center' }}>{`Type the amount in ${words}, like 50 or 12.50.`}</Body>}
        <Button primary label="Save" disabled={!ok} hint={`Type the amount in ${words}, like 50 or 12.50.`} onPress={() => onSave(draft.trim())} />
      </View>
    </BottomSheet>
  )
}
