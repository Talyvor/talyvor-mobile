import { BffError, formatMinor, parseMinor, type InstantQuote, type InstantQuoteRequest, type InstantTo, type InstantTransfer } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { Redirect, router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useAccount } from '@/account'
import { Icon } from '@/components/icon'
import { MoneyLabel } from '@/components/money-label'
import { BottomSheet } from '@/components/pay-sheet'
import { Back, Body, Button, Card, Chip, Eyebrow, Field, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import {
  BALANCE_WORDS,
  CHOICES,
  INSTANT_TRANSFER,
  MONEY_WORDS,
  WORDS,
  approvalIsFor,
  approvalNamedIn,
  arrivesText,
  bankCurrency,
  initials,
  lockedFor,
  payeeLine,
  rateText,
  secondsLeft,
  sendRefusal,
} from '@/instant-transfer'
import { biometricName, checkItsYou, keyGone, keyGoneText, phoneKey, signWithThisPhone } from '@/keys'
import { haptic } from '@/motion'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B59.20 — Instant transfer on the phone (design P7 and P8, launch pack 4.1): who gets it, from which agent's account,
// how much, then one quote — you send, rate, fee, they get, and when it arrives — locked for 30 seconds, counting down,
// with a fresh quote when they run out. Continue checks Face ID, then sends it from the agent's account under one
// Idempotency-Key (Lens B59.15 to B59.17). When Lens asks for the owner's approval, the approval sheet signs it with this
// phone's key and it is sent again at a fresh quote under the same key. Hybrid only: any other kind goes back to Pay.

const FIATS = ['GBP', 'EUR', 'USD']

export default function InstantTransferScreen() {
  const { client } = useSession()
  const { shows } = useAccount(client)
  if (shows && !shows.instantTransfer) return <Redirect href="/pay" />
  return (
    <Screen>
      <Back home="/pay" />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>{WORDS.title}</Headline>
        <MoneyLabel capability={INSTANT_TRANSFER} />
      </View>
      {shows ? <InstantTransferForm /> : <LoadState loading error={null} />}
    </Screen>
  )
}

/** The quote Lens gave, and when it arrived here, so the countdown starts on this phone's clock. */
type Quoted = { quote: InstantQuote; at: number; for: string }
const arrived = (quote: InstantQuote, asked: string): Quoted => ({ quote, at: Date.now(), for: asked })
/** A quote Lens could not give, and when. */
type Failed = { err: unknown; at: number; for: string }
const failedAt = (err: unknown, asked: string): Failed => ({ err, at: Date.now(), for: asked })

function InstantTransferForm() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [accounts, payees, book, key] = await Promise.all([client.moneyAccounts(), client.payees(), client.book(), phoneKey(client).catch(() => null)])
    return {
      // An Instant transfer goes from an agent's account in pounds, euros or dollars.
      from: (accounts.accounts ?? []).filter((a) => a.status === 'open' && a.purpose === 'agent' && FIATS.includes(a.currency)),
      payees: payees.payees ?? [],
      agents: book.agents ?? [],
      signs: !!key?.here,
    }
  }, [client])
  const { data, error, loading } = useLoad(load)

  const [to, setTo] = useState<InstantTo>('talyvor_account')
  const [toAccount, setToAccount] = useState('')
  const [toCurrency, setToCurrency] = useState('USD')
  const [payeeID, setPayeeID] = useState('')
  const [accountID, setAccountID] = useState('')
  const [amount, setAmount] = useState('')
  const [typed, setTyped] = useState('')
  // One key per transfer: a retry, and the send again after the owner's approval, go under it, so money moves once.
  const [key, setKey] = useState(() => Crypto.randomUUID())
  const [quoted, setQuoted] = useState<Quoted | null>(null)
  const [quoteFailed, setQuoteFailed] = useState<Failed | null>(null)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState('')
  // The agent's rules refused it: the way to them goes with the words.
  const [ruleRefused, setRuleRefused] = useState(false)
  const [approvalID, setApprovalID] = useState<string | null>(null)
  const [sheetSaid, setSheetSaid] = useState('')
  const [declined, setDeclined] = useState(false)

  // The amount is quoted once typing stops, not at every key.
  useEffect(() => {
    const t = setTimeout(() => setTyped(amount), 400)
    return () => clearTimeout(t)
  }, [amount])

  const account = data?.from.find((a) => a.id === accountID) ?? data?.from[0]
  const agentOf = (id: string | undefined) => data?.agents.find((a) => a.id === id)
  const agent = agentOf(account?.agent_id)?.name ?? 'This agent'
  const choices = (data?.payees ?? []).filter((p) => (to === 'wallet' ? Boolean(p.address) : !p.address))
  const payee = choices.find((p) => p.id === payeeID)
  const minor = parseMinor(typed)
  const receiveCurrency = to === 'wallet' ? 'USDC' : to === 'bank_account' ? bankCurrency(payee?.country ?? '') : toCurrency
  const recipient = to === 'talyvor_account' ? toAccount.trim() : (payee?.id ?? '')
  const recipientName = to === 'talyvor_account' ? recipient : (payee?.name ?? '')
  const ask: InstantQuoteRequest | null =
    account && recipient && minor !== null
      ? { send_minor: minor, send_currency: account.currency, receive_currency: receiveCurrency, to, country: to === 'bank_account' ? (payee?.country ?? '') : '' }
      : null
  const asked = ask ? JSON.stringify(ask) : ''

  // A new recipient, account or amount is a new transfer: a new key, and nothing said about the last one.
  const [keyFor, setKeyFor] = useState(asked)
  if (keyFor !== asked) {
    setKeyFor(asked)
    setKey(Crypto.randomUUID())
    setRefused('')
    setDeclined(false)
  }
  // Quotes whatever is asked now, and again on each round (Try again, or the seconds ran out); an answer for an earlier
  // ask is dropped.
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!ask) return
    let live = true
    client.instantQuote(ask).then(
      (quote) => live && setQuoted(arrived(quote, asked)),
      (err) => live && setQuoteFailed(failedAt(err, asked)),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `asked` is `ask` written down
  }, [client, asked, round])
  /** A fresh quote for a send: the one on the screen has run out, or the owner's approval took its seconds. */
  const fresh = async () => {
    if (!ask) return null
    const quote = await client.instantQuote(ask)
    setQuoted(arrived(quote, asked))
    return quote
  }

  const q = quoted?.for === asked ? quoted.quote : null
  const failed = quoteFailed?.for === asked && (!quoted || quoted.at < quoteFailed.at) ? quoteFailed.err : null
  // The countdown, every quarter of a second while there is a quote.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!q) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [q])
  const seconds = quoted && q ? Math.min(lockedFor(q), secondsLeft(q, quoted.at, now)) : 0
  // The 30 seconds ran out: a fresh quote, unless a send or an approval is on its way.
  useEffect(() => {
    if (!q || !quoted || busy || approvalID !== null) return
    const timer = setTimeout(() => setRound((r) => r + 1), Math.max(0, quoted.at + lockedFor(q) * 1000 - Date.now()))
    return () => clearTimeout(timer)
  }, [q, quoted, busy, approvalID])

  const holds = account ? { minor: account.live_minor, currency: account.currency } : null
  const sendAt = (quote: InstantQuote) =>
    client.instantSend(account?.agent_id ?? '', { quote_id: quote.id, ...(to === 'talyvor_account' ? { to_account_id: recipient } : { to_payee_id: recipient }) }, key)
  const sent = (t: InstantTransfer) => {
    haptic('success')
    setKey(Crypto.randomUUID())
    router.push({ pathname: '/instant-transfer/[id]', params: { id: t.id } })
  }
  const amountWords = q ? `${formatMinor(q.send_minor, q.send_currency)} to ${recipientName}` : ''

  // Continue: Face ID first, then the send. Lens may answer that the owner's approval is needed: the sheet opens for it.
  const send = async () => {
    if (!q) return
    setBusy(true)
    setRefused('')
    setRuleRefused(false)
    setDeclined(false)
    try {
      const check = await checkItsYou(`Send ${amountWords}`)
      if (check === 'gone') return setRefused(keyGoneText)
      if (check === 'cancelled') return setRefused('Cancelled. Nothing was sent.')
      if (check === 'off') return setRefused(`Turn on Approve with ${biometricName} on this phone first.`)
      const at = seconds > 0 ? q : await fresh()
      if (!at) return setRefused(WORDS.expired)
      sent(await sendAt(at))
    } catch (err) {
      const id = approvalNamedIn(err)
      if (id) {
        setSheetSaid('')
        setApprovalID(id)
      } else {
        if (err instanceof BffError) haptic('warning')
        setRefused(sendRefusal(err, agent, holds))
        setRuleRefused(err instanceof BffError && err.field === 'may_instant_transfer')
      }
    } finally {
      setBusy(false)
    }
  }
  // The approval sheet's Approve: signed with this phone's key over Lens's challenge, then sent again at a fresh quote.
  const approve = async () => {
    if (!approvalID || !q || !account) return
    setBusy(true)
    setSheetSaid('')
    try {
      // Only the approval this transfer waits on is signed: read it, and check it before Face ID is asked.
      const filed = (await client.approvals()).approvals?.find((a) => a.id === approvalID)
      if (!approvalIsFor(filed, account, q)) return setSheetSaid('Nothing changed. You can try again.')
      const { challenge } = await client.approvalChallenge(approvalID)
      await client.approve(approvalID, await signWithThisPhone(client, challenge, `Approve ${amountWords}`))
      const at = await fresh()
      if (!at) return setSheetSaid(WORDS.noQuote)
      const t = await sendAt(at)
      setApprovalID(null)
      sent(t)
    } catch (err) {
      if (keyGone(err)) setSheetSaid(keyGoneText)
      else if (err instanceof BffError) {
        haptic('warning')
        setSheetSaid(sendRefusal(err, agent, holds))
      } else setSheetSaid('Cancelled. Nothing was sent.')
    } finally {
      setBusy(false)
    }
  }
  const decline = async () => {
    if (!approvalID) return
    setBusy(true)
    setSheetSaid('')
    try {
      const k = await phoneKey(client)
      const assertion = k?.here ? await signWithThisPhone(client, (await client.approvalChallenge(approvalID)).challenge, `Decline ${amountWords}`) : undefined
      await client.deny(approvalID, assertion)
      setApprovalID(null)
      setDeclined(true)
      setKey(Crypto.randomUUID())
    } catch (err) {
      setSheetSaid(err instanceof BffError ? sendRefusal(err, agent, holds) : 'Cancelled. Nothing changed.')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <LoadState loading={loading} error={error} />
  const why = !recipient ? WORDS.pickWho : minor === null ? WORDS.addAmount : null

  return (
    <>
      <Eyebrow>{WORDS.whoGetsIt}</Eyebrow>
      <View accessibilityRole="radiogroup" accessibilityLabel={WORDS.whoGetsIt} style={{ gap: 8 }}>
        {CHOICES.map((choice) => (
          <Pressable
            key={choice.to}
            accessibilityRole="radio"
            accessibilityLabel={choice.title}
            accessibilityState={{ checked: to === choice.to }}
            onPress={() => {
              setTo(choice.to)
              setPayeeID('')
            }}
            style={{ gap: 2, padding: 14, borderRadius: 16, backgroundColor: c.page, borderWidth: to === choice.to ? 2 : 1, borderColor: to === choice.to ? c.ink : c.line }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{choice.title}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: c.ink2 }}>{choice.line}</Text>
          </Pressable>
        ))}
      </View>

      <Eyebrow>To</Eyebrow>
      {to === 'talyvor_account' ? (
        <>
          <Field label="Their Talyvor account" placeholder="macc_…" autoCapitalize="none" autoCorrect={false} value={toAccount} onChangeText={setToAccount} />
          <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13.5, color: c.ink2 }}>They get</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="They get" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['USD', 'EUR', 'GBP', 'USDC'].map((cur) => (
              <Pressable
                key={cur}
                accessibilityRole="radio"
                accessibilityState={{ checked: toCurrency === cur }}
                onPress={() => setToCurrency(cur)}
                style={{ minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 20, backgroundColor: toCurrency === cur ? c.ink : c.cloud2 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: toCurrency === cur ? c.page : c.ink }}>{MONEY_WORDS[cur]}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : choices.length === 0 ? (
        <Body muted>{`${to === 'wallet' ? 'No saved wallet yet.' : 'No payees yet.'} Payees are added in Talyvor on the web.`}</Body>
      ) : (
        <Card white>
          {choices.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityLabel={`${p.name}, ${payeeLine(p)}`}
              accessibilityState={{ checked: payeeID === p.id }}
              onPress={() => setPayeeID(p.id)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{initials(p.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{p.name}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{payeeLine(p)}</Text>
              </View>
              {payeeID === p.id ? <Icon name="check" color={c.ink} /> : null}
            </Pressable>
          ))}
        </Card>
      )}

      <Eyebrow>From</Eyebrow>
      {data.from.length === 0 ? (
        <Body muted>An Instant transfer goes from an agent’s account in pounds, euros or dollars: open one on Invoices first.</Body>
      ) : (
        <Card white>
          {data.from.map((a, i) => {
            const who = agentOf(a.agent_id)
            return (
              <Pressable
                key={a.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: account?.id === a.id }}
                onPress={() => setAccountID(a.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{[who?.name ?? 'This agent', who?.description].filter(Boolean).join(' · ')}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{`${BALANCE_WORDS[a.currency] ?? a.currency} balance · holds ${formatMinor(a.live_minor, a.currency)}`}</Text>
                </View>
                {account?.id === a.id ? <Icon name="check" color={c.ink} /> : null}
              </Pressable>
            )
          })}
        </Card>
      )}
      {account ? <Field label="Amount" keyboardType="decimal-pad" placeholder={account.currency} value={amount} onChangeText={setAmount} /> : null}

      <Card white>
        <View testID="instant-quote" style={{ gap: 10 }}>
          {why !== null ? (
            <Body muted>{why}</Body>
          ) : failed ? (
            <>
              <Body muted>{failed instanceof BffError && failed.status < 500 && failed.status !== 409 ? sendRefusal(failed, agent, holds) : WORDS.noQuote}</Body>
              <Button small variant="secondary" label={WORDS.tryAgain} onPress={() => setRound((r) => r + 1)} />
            </>
          ) : !q ? (
            <Body muted>{WORDS.gettingQuote}</Body>
          ) : (
            <>
              <QuoteFact label={WORDS.youSend} value={formatMinor(q.send_minor, q.send_currency)} />
              <QuoteFact label={WORDS.rate} value={rateText(q.rate, q.send_currency, q.receive_currency)} />
              <QuoteFact label={WORDS.fee} value={formatMinor(q.fee_minor, q.send_currency)} />
              <QuoteFact label={WORDS.theyGet} value={formatMinor(q.receive_minor, q.receive_currency)} strong />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Chip>{arrivesText(q)}</Chip>
                <Body muted>{`Locked for ${lockedFor(q)} seconds`}</Body>
              </View>
              <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: c.tint }}>
                <View style={{ height: 6, width: `${Math.min(100, (seconds / Math.max(1, lockedFor(q))) * 100)}%`, backgroundColor: c.ink }} />
              </View>
              {seconds > 0 ? (
                <Text testID="instant-seconds-left" accessibilityLiveRegion="polite" style={{ fontFamily: fonts.ui, fontSize: 13.5, color: c.ink3, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {`${seconds} seconds left`}
                </Text>
              ) : (
                <>
                  <Body muted>{WORDS.expired}</Body>
                  <Button small variant="secondary" label={WORDS.newQuote} onPress={() => setRound((r) => r + 1)} />
                </>
              )}
            </>
          )}
        </View>
      </Card>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Icon name="faceid" size={16} color={c.ink2} />
        <Body muted style={{ flex: 1, fontSize: 13 }}>
          {WORDS.faceIdAsks(biometricName === 'Face ID' ? 'Face ID' : 'Your fingerprint')}
        </Body>
      </View>
      <Button primary label={busy && approvalID === null ? 'Sending…' : WORDS.continue} disabled={!q || seconds === 0 || busy || approvalID !== null} hint={why ?? WORDS.gettingQuote} onPress={() => void send()} />
      {refused ? (
        <View testID="instant-refused" style={{ gap: 8 }}>
          <Body style={{ color: c.danger }}>{refused}</Body>
          {ruleRefused && account?.agent_id ? (
            <Button small variant="secondary" label={`Open ${agent}’s rules`} onPress={() => router.push({ pathname: '/agents/[id]', params: { id: account.agent_id ?? '' } })} />
          ) : null}
        </View>
      ) : null}
      {declined ? <Body muted>{WORDS.declined}</Body> : null}

      {/* P8 — the approval sheet, when Lens asks for the owner's yes. */}
      <BottomSheet visible={approvalID !== null} onClose={busy ? undefined : () => setApprovalID(null)} testID="instant-approval">
        {q && account ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fonts.uiBold }}>{WORDS.title}</Body>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{`From ${agent}’s account`}</Text>
              </View>
              <MoneyLabel capability={INSTANT_TRANSFER} />
            </View>
            <Text style={{ fontFamily: fonts.display, fontSize: 44, color: c.ink, fontVariant: ['tabular-nums'] }}>{formatMinor(q.send_minor, q.send_currency)}</Text>
            <Body>
              {'to '}
              <Text style={{ fontFamily: fonts.uiBold }}>{recipientName}</Text>
            </Body>
            <Body muted>{`They get ${formatMinor(q.receive_minor, q.receive_currency)} · ${arrivesText(q)}`}</Body>
            <View style={{ backgroundColor: c.cloud, borderRadius: 16, paddingHorizontal: 14 }}>
              <QuoteFact label={WORDS.paidFrom} value={`${agent}’s ${BALANCE_WORDS[account.currency] ?? account.currency} balance`} note={`(holds ${formatMinor(account.live_minor, account.currency)})`} padded />
              <QuoteFact label="Expires" value={seconds > 0 ? `In ${seconds} seconds, with the quote` : WORDS.expired} padded line />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Icon name="check" size={16} color={c.ink2} />
              <Body muted style={{ flex: 1, fontSize: 13 }}>
                {WORDS.approvesOnly}
              </Body>
            </View>
            {sheetSaid ? <Body style={{ color: c.danger }}>{sheetSaid}</Body> : null}
            {data.signs ? (
              <Button primary icon={biometricName === 'Face ID' ? 'faceid' : 'key'} label={`Approve with ${biometricName}`} disabled={busy} hint="Approving…" onPress={() => void approve()} />
            ) : (
              <>
                <Body muted>{`Turn on Approve with ${biometricName} on this phone first.`}</Body>
                <Button
                  primary
                  label="Approvals on this phone"
                  onPress={() => {
                    setApprovalID(null)
                    router.push('/approvals')
                  }}
                />
              </>
            )}
            <Button variant="secondary" label="Decline" haptic={false} disabled={busy} hint="Declining…" onPress={() => void decline()} />
          </View>
        ) : null}
      </BottomSheet>
    </>
  )
}

function QuoteFact({ label, value, note, strong, padded, line }: { label: string; value: string; note?: string; strong?: boolean; padded?: boolean; line?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={[{ gap: 2 }, padded && { paddingVertical: 12 }, line && { borderTopWidth: 1, borderTopColor: c.line }]}>
      <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Body muted>{label}</Body>
        <Text style={{ flex: 1, textAlign: 'right', fontFamily: strong ? fonts.display : fonts.uiMedium, fontSize: strong ? 18 : 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
      </View>
      {note ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3, textAlign: 'right' }}>{note}</Text> : null}
    </View>
  )
}
