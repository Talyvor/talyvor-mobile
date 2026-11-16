import { amountMinor, formatMinor, refusalText, type CurrencyAccount, type FundingDirection } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { useEffect, useState } from 'react'
import { ScrollView, useWindowDimensions, View } from 'react-native'

import { useAccount } from '../account'
import { useSession } from '../session'
import { useTheme } from '../theme'
import { BottomSheet } from './pay-sheet'
import { Body, Button, Field, Figure, Headline } from './ui'

// B61.85 — Add money and Take back on the phone, the web's B61.84 (talyvor-suite AgentFunding.tsx) with its words, as
// Pocket Live's fund and take sheets draw them. The owner or an admin gives an agent money from the company's account in
// the agent's account's currency, or takes it back, now (BFF B61.84, Lens B61.66). The amount is typed in the account's
// currency on the keypad; the sheet names the company's account it comes from or goes to and what that holds; one review
// line; one move under one key, so a second press moves nothing twice; then the screen says what moved and reads both
// balances again. Lens decides who may and how much: every refusal is its own sentence.

export type { FundingDirection }

/** An account's currency in words, as the web's agent page names it: "US dollar account". */
const ACCOUNT_WORDS: Record<string, string> = { USD: 'US dollar account', GBP: 'Pound account', EUR: 'Euro account', USDC: 'USDC account' }
const accountWords = (currency: string) => ACCOUNT_WORDS[currency] ?? `${currency} account`

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
  const [amount, setAmount] = useState('')
  const [reviewing, setReviewing] = useState(false)
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
  const ready = agentAccount !== undefined && companyAccount !== undefined && minor !== null
  const close = busy ? undefined : onClose

  const move = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const f = await client.agentFunding(agentAccount!.id, direction, minor!, key)
      setKey(Crypto.randomUUID())
      const moved = formatMinor(f.amount_minor, f.currency)
      onDone(toAgent ? `${moved} moved to ${agent.name}.` : `${moved} back from ${agent.name}.`)
      onClose()
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }

  const line =
    companyAccount === undefined
      ? `${Ours} has no ${accountWords(currency)}.`
      : toAgent
        ? `From ${ours}. It holds ${formatMinor(companyAccount.balance_minor, currency)}.`
        : `Into ${ours}. ${agent.name} holds ${formatMinor(agentAccount?.balance_minor ?? 0, currency)}.`

  return (
    <BottomSheet visible onClose={close} testID="agent-funding">
      <ScrollView style={{ maxHeight: height * 0.75 }} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
        <Headline>{toAgent ? `Add money to ${agent.name}` : `Take back from ${agent.name}`}</Headline>
        {read ? (
          <Body style={{ color: c.danger }}>{read}</Body>
        ) : accounts === null ? (
          <Body muted>Reading…</Body>
        ) : its.length === 0 ? (
          <Body muted>{`${agent.name} has no account yet. Open one in Talyvor on the web first.`}</Body>
        ) : reviewing && ready ? (
          <View style={{ gap: 12 }} testID="agent-funding-review">
            <Figure size={28}>{total}</Figure>
            <Body muted>
              {toAgent
                ? `From ${ours} to ${agent.name}’s ${accountWords(currency)}, now.`
                : `From ${agent.name}’s ${accountWords(currency)} back to ${ours}, now.`}
            </Body>
            <Button primary label={busy ? 'Moving…' : `${toAgent ? 'Move' : 'Take back'} ${total}`} disabled={busy} hint="Moving…" onPress={() => void move()} />
            <Button variant="secondary" label="Back" disabled={busy} hint="Moving…" onPress={() => setReviewing(false)} />
            {refusal ? <Body style={{ color: c.danger }}>{refusal}</Body> : null}
          </View>
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
            <Field label={`Amount in ${currency}`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
            <Button
              primary
              label="Continue"
              disabled={!ready}
              hint={agentAccount === undefined ? `${agent.name} has no ${accountWords(currency)}.` : companyAccount === undefined ? line : 'Add an amount first.'}
              onPress={() => setReviewing(true)}
            />
            <Button variant="secondary" label="Cancel" onPress={onClose} />
          </>
        )}
      </ScrollView>
    </BottomSheet>
  )
}
