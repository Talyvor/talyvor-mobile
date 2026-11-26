import { amountMinor, BffError, formatMinor, refusalText, type CurrencyAccount, type FundingDirection } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native'

import { useAccount } from '../account'
import { moneyMoved } from '../effects'
import { useSession } from '../session'
import { outcome } from '../sound'
import { fonts, useTheme } from '../theme'
import { useTick } from './effects'
import { AGENT_CREDIT, MoneyLabel } from './money-label'
import { BottomSheet } from './pay-sheet'
import { Body, Button, Field, Headline } from './ui'

// B61.85 — Add money and Take back on the phone, the web's B61.84 (talyvor-suite AgentFunding.tsx) with its words, as
// Pocket Live's fund and take sheets draw them. The owner or an admin gives an agent money from the company's account in
// the agent's account's currency, or takes it back, now (BFF B61.84, Lens B61.66). The amount is typed in the account's
// currency on the keypad; the sheet names the company's account it comes from or goes to and what that holds; one review
// line; one move under one key, so a second press moves nothing twice; then the screen says what moved and reads both
// balances again. Lens decides who may and how much: every refusal is its own sentence.
// B57.181 — in Pocket, as Pocket Live's sheets fund and take draw them: the title with the Sandbox label beside it, the
// line, then $50, $100 and $200 with $100 chosen, and one button that says what it moves and moves it, so the sheet is
// its own review. An amount of its own can still be typed in the account's currency; typing one unchooses the three.

export type { FundingDirection }

/** An account's currency in words, as the web's agent page names it: "US dollar account". */
const ACCOUNT_WORDS: Record<string, string> = { USD: 'US dollar account', GBP: 'Pound account', EUR: 'Euro account', USDC: 'USDC account' }
const accountWords = (currency: string) => ACCOUNT_WORDS[currency] ?? `${currency} account`

/** Pocket Live's three amounts for the fund and take sheets, in whole units of the account's currency; the middle one is chosen. */
const PRESETS = ['50', '100', '200']
const presetWords = (whole: string, currency: string) => {
  const minor = amountMinor(whole, currency)
  return minor === null ? whole : formatMinor(minor, currency).replace(/\.00(?=\D*$)/, '')
}

/** Add money and Take back for one agent: the sheet, drawn while `direction` is set; `onDone` is given what moved. */
export function AgentFundingSheet({
  agent,
  direction,
  onClose,
  onDone,
}: {
  agent: { id: string; name: string }
  direction: FundingDirection | null
  onClose: () => void
  onDone: (said: string) => void
}) {
  // Drawn only while open, so each opening reads the accounts again and starts under a key of its own.
  return direction ? <FundingSheet agent={agent} direction={direction} onClose={onClose} onDone={onDone} /> : null
}

function FundingSheet({ agent, direction, onClose, onDone }: { agent: { id: string; name: string }; direction: FundingDirection; onClose: () => void; onDone: (said: string) => void }) {
  const { client } = useSession()
  const { c } = useTheme()
  const { height } = useWindowDimensions()
  const { shows } = useAccount(client)
  const [accounts, setAccounts] = useState<CurrencyAccount[] | null>(null)
  const [read, setRead] = useState('')
  const [chosen, setChosen] = useState('')
  const [amount, setAmount] = useState(PRESETS[1])
  const [typed, setTyped] = useState(false)
  const [key, setKey] = useState(() => Crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')

  useEffect(() => {
    let live = true
    client.moneyAccounts().then(
      (r) => live && setAccounts((r.accounts ?? []).filter((a) => a.status === 'open')),
      (err) => live && setRead(refusalText(err)),
    )
    return () => {
      live = false
    }
  }, [client])

  const toAgent = direction === 'to_agent'
  const company = (accounts ?? []).filter((a) => a.purpose === 'company')
  const its = (accounts ?? []).filter((a) => a.purpose === 'agent' && a.agent_id === agent.id)
  const currencies = [...new Set([...its, ...company].map((a) => a.currency))]
  const currency = chosen || its[0]?.currency || currencies[0] || ''
  const agentAccount = its.find((a) => a.currency === currency)
  const companyAccount = company.find((a) => a.currency === currency)
  const minor = currency ? amountMinor(amount, currency) : null
  const total = minor !== null ? formatMinor(minor, currency) : ''
  // The reference's words: "your account" for a person's own, "the company account" for a business.
  const ours = shows?.owner === 'Your account' ? 'your account' : 'the company account'
  const Ours = `${ours.charAt(0).toUpperCase()}${ours.slice(1)}`
  const ready = agentAccount !== undefined && companyAccount !== undefined && minor !== null && minor > 0
  const close = busy ? undefined : onClose
  const { ticked, tick } = useTick()

  const move = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const f = await client.agentFunding(agentAccount!.id, direction, minor!, key)
      outcome('moved')
      moneyMoved('inside')
      setKey(Crypto.randomUUID())
      const moved = formatMinor(f.amount_minor, f.currency)
      // B61.130 — the answer is in: the button ticks, then the sheet closes. Still busy, so nothing more is sent.
      await tick()
      onDone(toAgent ? `${moved} moved to ${agent.name}.` : `${moved} back from ${agent.name}.`)
      onClose()
    } catch (err) {
      if (err instanceof BffError) outcome('refused')
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }

  const line =
    companyAccount === undefined
      ? `${Ours} has no ${accountWords(currency)}.`
      : toAgent
        ? `From ${ours}. It holds ${formatMinor(companyAccount.live_minor, currency)}.`
        : `Into ${ours}. ${agent.name} holds ${formatMinor(agentAccount?.live_minor ?? 0, currency)}.`

  return (
    <BottomSheet visible onClose={close} testID="agent-funding">
      <ScrollView style={{ maxHeight: height * 0.75 }} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Headline>{toAgent ? `Add money to ${agent.name}` : `Take back from ${agent.name}`}</Headline>
          </View>
          <MoneyLabel capability={AGENT_CREDIT} />
        </View>
        {read ? (
          <Body style={{ color: c.danger }}>{read}</Body>
        ) : accounts === null ? (
          <Body muted>Reading…</Body>
        ) : its.length === 0 ? (
          <Body muted>{`${agent.name} has no account yet. Open one in Talyvor on the web first.`}</Body>
        ) : (
          <>
            <Body muted>{line}</Body>
            {agentAccount === undefined ? (
              <View style={{ gap: 8 }} testID="agent-funding-other-currencies">
                <Body muted>{`${agent.name} has no ${accountWords(currency).replace(/ account$/, '')} account. It has:`}</Body>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {its.map((a) => (
                    <Button key={a.id} small variant="secondary" label={accountWords(a.currency)} onPress={() => setChosen(a.currency)} />
                  ))}
                </View>
              </View>
            ) : null}
            {currencies.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Currency">
                {currencies.map((cur) => (
                  <Button
                    key={cur}
                    small
                    variant={cur === currency ? 'primary' : 'secondary'}
                    label={cur}
                    accessibilityLabel={`Currency ${cur}${cur === currency ? ', chosen' : ''}`}
                    onPress={() => setChosen(cur)}
                  />
                ))}
              </View>
            ) : null}
            <View accessibilityRole="radiogroup" accessibilityLabel="Amount" testID="agent-funding-amounts" style={{ flexDirection: 'row', gap: 6, padding: 2 }}>
              {PRESETS.map((whole) => {
                const on = !typed && amount === whole
                const words = presetWords(whole, currency)
                return (
                  <Pressable
                    key={whole}
                    accessibilityRole="radio"
                    accessibilityLabel={words}
                    accessibilityState={{ checked: on }}
                    disabled={busy}
                    onPress={() => {
                      setTyped(false)
                      setAmount(whole)
                    }}
                    style={{ flex: 1, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.ink : c.cloud }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: on ? c.page : c.ink2 }}>{words}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Field
              label={`Amount in ${currency}`}
              keyboardType="decimal-pad"
              value={typed ? amount : ''}
              editable={!busy}
              onChangeText={(v) => {
                setTyped(v !== '')
                setAmount(v === '' ? PRESETS[1] : v)
              }}
            />
            <Button
              primary
              label={busy ? 'Moving…' : `${toAgent ? 'Move' : 'Take back'}${total ? ` ${total}` : ''}`}
              disabled={!ready || busy}
              done={ticked}
              hint={busy ? 'Moving…' : agentAccount === undefined ? `${agent.name} has no ${accountWords(currency)}.` : companyAccount === undefined ? line : 'Add an amount first.'}
              onPress={() => void move()}
            />
            {refusal ? <Body style={{ color: c.danger }}>{refusal}</Body> : null}
          </>
        )}
      </ScrollView>
    </BottomSheet>
  )
}
