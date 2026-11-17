import { BffError, formatMinor, type LadderPlan, type WorkspacePlan } from '@talyvor/bff-client'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { useAccount } from '@/account'
import { Money } from '@/components/money'
import { MoneyLabel, useMoneyLabels } from '@/components/money-label'
import { BottomSheet } from '@/components/pay-sheet'
import { Back, Body, Button, Card, Chip, Eyebrow, Headline, Row, Screen, useLoad } from '@/components/ui'
import { openHelpMail } from '@/help-words'
import { PLAN_CAPABILITY, PLAN_WORDS as W, agentsOf, agentsUsed, exchangeFee, peopleOf, planCurrency, priceIn } from '@/plan-words'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.60 — /settings/plan, the web's Settings, Plan (suite B61.59) on the phone: the account's plan by its name with its
// monthly price in the account's own currency, what it includes and what is used, and the ladder of the account's own
// type with Change plan on the others. A Personal account sees Solo, Crew and Fleet; a Business sees Studio, Company,
// Group and Custom, which is talked about by email, never chosen here.
//
// ⚠ EVERY FIGURE IS LENS'S. The plan, its price and its agents come from GET /api/plan; the ladders and the exchange fee
// from GET /api/pricing (Lens's GET /v1/public/plans and fees). A plan Lens did not state is not drawn. Changing plan is
// PUT /api/plan after one confirmation, and Lens decides it: its refusal is said in its own words.
//
// B57.180 — drawn in Pocket, as Pocket Live's Settings sub-pages (sub:plan, sub:security) and the app's Wallets draw
// theirs: the Sandbox label beside the headline, Your plan in a cloud card, the plan's facts with the label on the left
// and the figure on the right, the ladder under Pocket Live's section head as one card with a rule between plans, and the
// change as Pocket's sheet with the label beside its question.

const signedOut = (err: unknown) => err instanceof BffError && err.status === 401

function MonthlyPrice({ minor, currency, size = 17 }: { minor: number | null; currency: string; size?: number }) {
  const { c } = useTheme()
  if (minor === null) return <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{W.byContract}</Text>
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
      <Money minor={minor} currency={currency} size={size} />
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 14, color: c.ink2 }}>{W.aMonth}</Text>
    </View>
  )
}

/** Pocket Live's section head (.sec-h h3): the display face at 18, ink, over the card it names. */
function SectionHead({ children }: { children: string }) {
  const { c } = useTheme()
  return (
    <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 21.5, color: c.ink, marginTop: 8 }}>
      {children}
    </Text>
  )
}

/** Pocket Live's facts: the label on the left in ink-2, the figure on the right, a rule between. */
function Fact({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const { c } = useTheme()
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 11, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      <Body muted>{label}</Body>
      <Body style={{ flexShrink: 1, textAlign: 'right', fontFamily: fonts.uiMedium }}>{value}</Body>
    </View>
  )
}

/** One plan of the ladder, a row of its card: its name, with Your plan on the account's own; its agents, people and
 * exchange fee under it; its monthly price on the right; Change plan, or Custom's way to talk to us, under the row. */
function LadderPlanRow({
  plan,
  current,
  currency,
  fx,
  first,
  last,
  onChange,
}: {
  plan: LadderPlan
  current: boolean
  currency: string
  fx: Record<string, number> | undefined
  first: boolean
  last: boolean
  onChange: (() => void) | null
}) {
  const { c } = useTheme()
  const fee = exchangeFee(fx, plan.id)
  const sub = { fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: c.ink3 }
  return (
    <View testID={`ladder-${plan.id}`} style={{ gap: 12, paddingTop: first ? 0 : 14, paddingBottom: last ? 0 : 4, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 22, color: c.ink }}>
              {plan.name}
            </Text>
            {current ? <Chip tone="good">{W.yourPlan}</Chip> : null}
          </View>
          <View>
            <Text style={sub}>{agentsOf(plan.agents)}</Text>
            <Text style={sub}>{peopleOf(plan.people)}</Text>
            {fee && !plan.by_contract ? <Text style={sub}>{fee}</Text> : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <MonthlyPrice minor={priceIn(plan.price_minor, currency)} currency={currency} size={16} />
        </View>
      </View>
      {plan.by_contract ? (
        <View style={{ flexDirection: 'row' }}>
          <Button small variant="secondary" label={W.custom} onPress={() => void openHelpMail('')} />
        </View>
      ) : onChange ? (
        <View style={{ flexDirection: 'row' }}>
          <Button small variant="secondary" label={W.change} accessibilityLabel={`${W.change}: ${plan.name}`} onPress={onChange} />
        </View>
      ) : null}
    </View>
  )
}

/** What changes, in words: the price, the agents and the people, each "instead of" today's. */
function whatChanges(from: LadderPlan | undefined, to: LadderPlan, currency: string, served: WorkspacePlan): string[] {
  const lines: string[] = []
  const now = priceIn(from?.price_minor ?? served.price_minor, currency)
  const next = priceIn(to.price_minor, currency)
  if (next !== null) lines.push(`You pay ${formatMinor(next, currency)} a month${now !== null ? ` instead of ${formatMinor(now, currency)}` : ''}.`)
  lines.push(`${agentsOf(to.agents)} instead of ${agentsOf(served.agents).toLowerCase()}.`)
  if (from) lines.push(`${peopleOf(to.people)} instead of ${peopleOf(from.people).toLowerCase()}.`)
  return lines
}

/** The refusal, in Lens's words where it gave them. */
function changeRefusal(err: unknown): string {
  if (signedOut(err)) return W.signInToChange
  if (err instanceof BffError && err.status < 500 && err.sentence) return err.sentence
  return W.notChanged
}

function ChangePlanSheet({
  to,
  from,
  currency,
  served,
  onClose,
  onChanged,
}: {
  to: LadderPlan
  from: LadderPlan | undefined
  currency: string
  served: WorkspacePlan
  onClose: () => void
  onChanged: (name: string) => void
}) {
  const { client } = useSession()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const change = async () => {
    setBusy(true)
    setRefusal('')
    try {
      await client.changePlan(to.id)
      onChanged(to.name)
    } catch (err) {
      setRefusal(changeRefusal(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet visible testID="plan-change-sheet" onClose={busy ? undefined : onClose}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <Text accessibilityRole="header" style={{ flex: 1, fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: c.ink }}>
            {W.changeToAsk(to.name)}
          </Text>
          <MoneyLabel capability={PLAN_CAPABILITY} />
        </View>
        <View testID="plan-change-lines" style={{ gap: 4 }}>
          {whatChanges(from, to, currency, served).map((line) => (
            <Body key={line} muted>
              {line}
            </Body>
          ))}
        </View>
        {refusal ? (
          <View accessibilityRole="alert" testID="plan-change-refusal">
            <Body style={{ color: c.danger }}>{refusal}</Body>
          </View>
        ) : null}
        <Button variant="primary" label={busy ? W.changing : W.changeTo(to.name)} disabled={busy} onPress={() => void change()} />
        <Button variant="ghost" label={W.cancel} disabled={busy} onPress={onClose} />
      </View>
    </BottomSheet>
  )
}

export default function PlanScreen() {
  const { client } = useSession()
  const { account } = useAccount(client)
  const loadPlan = useCallback(() => client.plan(), [client])
  const loadPricing = useCallback(async () => {
    const [pricing, accounts] = await Promise.all([client.planPricing(), client.moneyAccounts().catch(() => ({ accounts: null }))])
    const own = (accounts.accounts ?? []).filter((a) => a.purpose === 'company' && a.status !== 'closed').map((a) => a.currency)
    return { ...pricing, own }
  }, [client])
  const plan = useLoad(loadPlan)
  const pricing = useLoad(loadPricing)
  const labels = useMoneyLabels()
  const [changing, setChanging] = useState<LadderPlan | null>(null)
  const [changed, setChanged] = useState('')

  const served = plan.data
  const type = served?.account_type
  const ladders = pricing.data?.ladders
  const fx = pricing.data?.fees?.fx_margin_bps
  const ladder = ladders && type ? ladders[type] : undefined
  const mine = ladder?.find((p) => p.id === served?.plan)
  const currency = ladders && account ? planCurrency(ladders, account.money_kind === 'stablecoin', pricing.data?.own ?? []) : undefined
  // A plan is paid to Talyvor: Lens's label for spending on Talyvor says whether that is Sandbox, and while it is, the
  // plan costs nothing and the screen says so.
  const sandbox = labels?.[PLAN_CAPABILITY] === 'sandbox'
  const fee = served ? exchangeFee(fx, served.plan) : null
  const reading = (plan.loading && !served) || (pricing.loading && !pricing.data)

  return (
    <Screen
      onRefresh={() => {
        plan.reload()
        pricing.reload()
      }}
      refreshing={(plan.loading && !!served) || (pricing.loading && !!pricing.data)}>
      <Back home="/settings" />
      <View testID="plan-head" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>{W.title}</Headline>
        <MoneyLabel capability={PLAN_CAPABILITY} />
      </View>
      {reading ? (
        <Body muted>{W.reading}</Body>
      ) : !served || !type ? (
        <Body muted>{signedOut(plan.error) ? W.signInToRead : W.readFailed}</Body>
      ) : (
        <>
          {changed ? (
            <View accessibilityRole="alert" testID="plan-changed">
              <Card tight>
                <Row first title={W.nowOn(changed)} sub={W.changed} />
              </Card>
            </View>
          ) : null}
          <View testID="plan-current" style={{ gap: 14 }}>
            <Card>
              <View style={{ gap: 6 }}>
                <Eyebrow>{W.yourPlan}</Eyebrow>
                <PlanName>{W.youAreOn(served.name ?? mine?.name ?? served.plan)}</PlanName>
                {currency ? <MonthlyPrice minor={priceIn(served.price_minor, currency)} currency={currency} size={24} /> : null}
                {sandbox ? (
                  <View testID="plan-sandbox-line" style={{ marginTop: 4 }}>
                    <Body muted>{W.sandbox}</Body>
                  </View>
                ) : null}
              </View>
            </Card>
            <Card tight>
              <Fact first label={W.agents} value={agentsUsed(served.agents_used, served.agents)} />
              <Fact label={W.people} value={peopleOf(served.seats)} />
              {fee ? <Fact label={W.exchange} value={fee} /> : null}
            </Card>
            {served.on_contract ? <Body muted>{W.onContract}</Body> : null}
          </View>

          <SectionHead>{type === 'personal' ? W.forPerson : W.forCompany}</SectionHead>
          {ladder && currency ? (
            <View testID="plan-ladder">
              <Card>
                {ladder.map((p, i) => (
                  <LadderPlanRow
                    key={p.id}
                    plan={p}
                    first={i === 0}
                    last={i === ladder.length - 1}
                    current={p.id === served.plan}
                    currency={currency}
                    fx={fx}
                    onChange={p.id === served.plan || served.on_contract ? null : () => setChanging(p)}
                  />
                ))}
              </Card>
            </View>
          ) : (
            <Body muted>{W.laddersFailed}</Body>
          )}

          {changing && currency ? (
            <ChangePlanSheet
              to={changing}
              from={mine}
              currency={currency}
              served={served}
              onClose={() => setChanging(null)}
              onChanged={(name) => {
                setChanging(null)
                setChanged(name)
                plan.reload()
              }}
            />
          ) : null}
        </>
      )}
    </Screen>
  )
}

function PlanName({ children }: { children: string }) {
  const { c } = useTheme()
  return <Text style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: c.ink }}>{children}</Text>
}
