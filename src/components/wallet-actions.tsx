import {
  amountMinor,
  BffError,
  formatMinor,
  refusalText,
  type BffClient,
  type CurrencyAccount,
  type DeviceAssertion,
  type OutsidePayee,
  type SideConversion,
} from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { Link, router } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, Text, useWindowDimensions, View } from 'react-native'

import type { Shows } from '../account'
import { biometricName, checkItsYou, forgetThisPhone, keyGone, keyGoneText, signWithThisPhone } from '../keys'
import { rateText } from '../instant-transfer'
import { fonts, useTheme } from '../theme'
import { CURRENCY_NAME, isStablecoin } from './home'
import { Icon, type IconName } from './icon'
import { AccountChoice, BottomSheet } from './pay-sheet'
import { Press } from './press'
import { Body, Button, Card, Eyebrow, Field, Figure, Headline } from './ui'

// B59.33 — Wallets' Top up, Withdraw and Convert on the phone, the web's B59.53 (talyvor-suite Wallets.tsx) with its words.
// Top up adds Sandbox money to one of the company's accounts; Withdraw pays a company fiat account out to a bank saved as
// the owner's own; Convert (Hybrid only) sells a currency for USDC or USDC for a currency, between the company's accounts
// on the two sides, quoted first. Each has a confirm step and nothing moves until Face ID (or the fingerprint) passes:
// Withdraw and Convert are signed with this phone's key over Lens's challenge, which names the move's Idempotency-Key;
// Top up, which Lens takes unsigned, passes the same check first. Each confirm step is one move under one key, so a retry
// after a dropped answer moves the money once. Lens decides everything; a refusal is its own sentence.

export type WalletAction = 'top-up' | 'withdraw' | 'convert'

const TITLE: Record<WalletAction, string> = { 'top-up': 'Add money', withdraw: 'Withdraw', convert: 'Convert' }

/** The actions the kind shows: Add money always, Withdraw with bank transfers, Convert for Hybrid. */
export function walletActions(shows: Pick<Shows, 'bankTransfers' | 'convert'>): WalletAction[] {
  return ['top-up', ...(shows.bankTransfers ? (['withdraw'] as const) : []), ...(shows.convert ? (['convert'] as const) : [])]
}

// The drawing's marks: Pay's plane, Convert's two arrows (the set's payments mark), Instant's arrow.
const ICON: Record<WalletAction, IconName> = { 'top-up': 'plus', withdraw: 'arrowUp', convert: 'payments' }

/** One round action, as Pocket Live's .qa draws it: a 56-wide circle over its word, the first one filled. */
function Round({ icon, label, primary, onPress, link }: { icon: IconName; label: string; primary?: boolean; onPress?: () => void; link?: string }) {
  const { c } = useTheme()
  return (
    <Press kind="round" accessibilityRole={link ? 'link' : 'button'} accessibilityLabel={link ?? label} onPress={onPress} style={{ flex: 1, maxWidth: 84, alignItems: 'center', gap: 7 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: primary ? c.primary : c.cloud, boxShadow: primary ? undefined : `inset 0 0 0 1px ${c.frostLine}`, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={primary ? c.onPrimary : c.ink} />
      </View>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: c.ink, textAlign: 'center' }}>{label}</Text>
    </Press>
  )
}

/** B57.156 — the round actions under the balances, in Pocket Live's order: Add money, Pay, then Withdraw and Convert as
 * the kind has them, and Instant for Hybrid. Pay and Instant open their own screens. */
export function WalletButtons({ shows, onPress }: { shows: Shows; onPress: (a: WalletAction) => void }) {
  const [first, ...rest] = walletActions(shows)
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
      <Round primary icon={ICON[first]} label={TITLE[first]} onPress={() => onPress(first)} />
      <Link href="/pay" asChild>
        <Round icon="send" label="Pay" link="Pay" />
      </Link>
      {rest.map((a) => (
        <Round key={a} icon={ICON[a]} label={TITLE[a]} onPress={() => onPress(a)} />
      ))}
      {shows.instantTransfer ? (
        <Link href="/instant-transfer" asChild>
          <Round icon="arrow" label="Instant" link="Instant transfer" />
        </Link>
      ) : null}
    </View>
  )
}

/** The company's open accounts on the sides the kind shows; only the fiat side with fiatOnly. */
const companyAccounts = (accounts: readonly CurrencyAccount[], shows: Shows, fiatOnly = false) =>
  accounts.filter((a) => a.status === 'open' && a.purpose === 'company' && (isStablecoin(a.currency) ? shows.onChain && !fiatOnly : shows.bankTransfers))

/** "Ada Lovelace · account ending 9911". */
const bankLine = (p: OutsidePayee) => {
  const number = p.iban || p.account_number || ''
  return number ? `${p.name} · account ending ${number.slice(-4)}` : p.name
}

/** The key no longer works: it goes, so Approvals offers Turn on again. */
async function keyWentText(): Promise<string> {
  await forgetThisPhone().catch(() => undefined)
  return keyGoneText
}

/** This phone's signature over a challenge, or why there is none: a cancelled check signs nothing. */
async function sign(client: BffClient, challenge: string, reason: string): Promise<DeviceAssertion | string> {
  try {
    return await signWithThisPhone(client, challenge, reason)
  } catch (err) {
    if (keyGone(err)) return keyWentText()
    return err instanceof BffError ? refusalText(err) : 'Nothing changed.'
  }
}

/** A sheet's content, scrolling once it is taller than most of the screen. */
function SheetBody({ children }: { children: ReactNode }) {
  const { height } = useWindowDimensions()
  return (
    <ScrollView style={{ maxHeight: height * 0.75 }} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  )
}

interface SheetProps {
  client: BffClient
  shows: Shows
  accounts: readonly CurrencyAccount[]
  /** this phone holds the workspace's approval key */
  hasKey: boolean
  onClose: () => void
  /** the money moved: the screen reads again */
  onDone: () => void
}

/** The sheet for one action; null shows none. */
export function WalletSheet({ action, ...props }: SheetProps & { action: WalletAction | null }) {
  return (
    <>
      <TopUp {...props} open={action === 'top-up'} />
      {props.shows.bankTransfers ? <Withdraw {...props} open={action === 'withdraw'} /> : null}
      {props.shows.convert ? <Convert {...props} open={action === 'convert'} /> : null}
    </>
  )
}

/** One fact of the confirm step: its label, and its value on the right. */
function Facts({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <Card>
      {facts.map(([label, value]) => (
        <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Body muted>{label}</Body>
          {typeof value === 'string' ? <Body style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Body> : value}
        </View>
      ))}
    </Card>
  )
}

/** The confirm step's button with Face ID, or the way to turn it on; Back, the refusal and what Face ID guards. */
function ConfirmButtons({ label, busy, busyLabel, hasKey, refusal, guards, onConfirm, onBack, onClose }: {
  label: string
  busy: boolean
  busyLabel: string
  hasKey: boolean
  refusal: string
  guards: string
  onConfirm: () => void
  onBack: () => void
  onClose: () => void
}) {
  return (
    <>
      {hasKey ? (
        <Button primary label={busy ? busyLabel : `${label} with ${biometricName}`} disabled={busy} hint={busyLabel} onPress={onConfirm} />
      ) : (
        <>
          <Body muted>{`Turn on Approve with ${biometricName} on this phone first: Talyvor asks for ${biometricName} before each payment from this phone.`}</Body>
          <Button
            primary
            label="Approvals on this phone"
            onPress={() => {
              onClose()
              router.push('/approvals')
            }}
          />
        </>
      )}
      <Button variant="secondary" label="Back" disabled={busy} hint={busyLabel} onPress={onBack} />
      {refusal ? <RefusalLine text={refusal} /> : null}
      <Body muted>{guards}</Body>
    </>
  )
}

/** The form step's Continue and Cancel. */
function FormButtons({ why, busy, busyLabel, onContinue, onClose }: { why?: string; busy?: boolean; busyLabel?: string; onContinue: () => void; onClose: () => void }) {
  return (
    <>
      <Button primary label={busy && busyLabel ? busyLabel : 'Continue'} disabled={why !== undefined || busy} hint={why ?? busyLabel} onPress={onContinue} />
      <Button variant="secondary" label="Cancel" disabled={busy} onPress={onClose} />
    </>
  )
}

/** Which of the company's accounts, by name and what it holds. */
function AccountPicker({ accounts, owner, chosen, onChoose }: { accounts: CurrencyAccount[]; owner: string; chosen?: CurrencyAccount; onChoose: (id: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>Account</Eyebrow>
      {accounts.map((a) => (
        <AccountChoice key={a.id} name={`${owner} · ${a.currency}`} balance={formatMinor(a.live_minor, a.currency)} chosen={a.id === chosen?.id} onPress={() => onChoose(a.id)} />
      ))}
    </View>
  )
}

const NO_ACCOUNT = 'Open an account in Talyvor on the web first.'

/** Add money (B61.80; was Top up): Sandbox money into one of the company's accounts, once under its key, after Face ID. */
function TopUp({ client, shows, accounts: all, hasKey, open, onClose, onDone }: SheetProps & { open: boolean }) {
  const accounts = companyAccounts(all, shows)
  const [accountID, setAccountID] = useState('')
  const [amount, setAmount] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const minor = account ? amountMinor(amount, account.currency) : null
  const total = account && minor !== null ? formatMinor(minor, account.currency) : ''
  const close = () => {
    if (busy) return
    setKey('')
    setAmount('')
    setRefusal('')
    onClose()
  }
  const top = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const check = await checkItsYou(`Add ${total}`)
      if (check === 'gone') return setRefusal(await keyWentText())
      if (check !== 'ok') return setRefusal('Nothing changed.')
      await client.walletTopUp(account!.id, minor!, key)
      setKey('')
      setAmount('')
      onDone()
      onClose()
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet visible={open} onClose={close} testID="top-up">
      <SheetBody>
      <Headline>Add money</Headline>
      {accounts.length === 0 ? (
        <Body muted>{NO_ACCOUNT}</Body>
      ) : key && account && minor !== null ? (
        <View style={{ gap: 12 }} testID="top-up-confirm">
          <Figure size={28}>{total}</Figure>
          <Facts facts={[['To', `${shows.owner} · ${account.currency}`]]} />
          <ConfirmButtons
            label="Add money"
            busy={busy}
            busyLabel="Adding…"
            hasKey={hasKey}
            refusal={refusal}
            guards={`${biometricName === 'Face ID' ? 'Face ID asks' : 'Your fingerprint is asked for'} before anything is added.`}
            onConfirm={() => void top()}
            onBack={() => setKey('')}
            onClose={close}
          />
        </View>
      ) : (
        <>
          <AccountPicker accounts={accounts} owner={shows.owner} chosen={account} onChoose={setAccountID} />
          <Field label="Amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <FormButtons why={minor === null ? 'Add an amount first.' : undefined} onContinue={() => setKey(Crypto.randomUUID())} onClose={close} />
        </>
      )}
      </SheetBody>
    </BottomSheet>
  )
}

/** Withdraw: one of the company's fiat accounts paid out to a bank saved as the owner's own, signed with this phone's key. */
function Withdraw({ client, shows, accounts: all, hasKey, open, onClose, onDone }: SheetProps & { open: boolean }) {
  const accounts = companyAccounts(all, shows, true)
  const [banks, setBanks] = useState<OutsidePayee[] | null>(null)
  const [read, setRead] = useState('')
  const [accountID, setAccountID] = useState('')
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  // Its own banks are read each time the sheet opens, since one may have been added on the web meanwhile; closing it
  // forgets them.
  useEffect(() => {
    if (!open) return
    let live = true
    client.payees().then(
      (p) => live && setBanks((p.payees ?? []).filter((x) => x.own && !x.address)),
      (err) => live && setRead(refusalText(err)),
    )
    return () => {
      live = false
    }
  }, [client, open])
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const bank = banks?.find((p) => p.id === payeeID) ?? banks?.[0]
  const minor = account ? amountMinor(amount, account.currency) : null
  const total = account && minor !== null ? formatMinor(minor, account.currency) : ''
  const why = minor === null ? 'Add an amount first.' : !bank ? 'Add your own bank first.' : undefined
  const close = () => {
    if (busy) return
    setKey('')
    setAmount('')
    setRefusal('')
    setBanks(null)
    setRead('')
    onClose()
  }
  const withdraw = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const body = { payee_id: bank!.id, amount_minor: minor! }
      const { challenge } = await client.walletWithdrawChallenge(account!.id, body, key)
      const assertion = await sign(client, challenge, `Withdraw ${total}`)
      if (typeof assertion === 'string') return setRefusal(assertion)
      await client.walletWithdraw(account!.id, body, key, assertion)
      setKey('')
      setAmount('')
      setBanks(null)
      onDone()
      onClose()
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet visible={open} onClose={close} testID="withdraw">
      <SheetBody>
      <Headline>Withdraw</Headline>
      {accounts.length === 0 ? (
        <Body muted>{NO_ACCOUNT}</Body>
      ) : key && account && bank && minor !== null ? (
        <View style={{ gap: 12 }} testID="withdraw-confirm">
          <Figure size={28}>{total}</Figure>
          <Facts
            facts={[
              ['From', `${shows.owner} · ${account.currency}`],
              ['To', bankLine(bank)],
            ]}
          />
          <ConfirmButtons
            label="Withdraw"
            busy={busy}
            busyLabel="Withdrawing…"
            hasKey={hasKey}
            refusal={refusal}
            guards={`${biometricName === 'Face ID' ? 'Face ID asks' : 'Your fingerprint is asked for'} before anything is sent.`}
            onConfirm={() => void withdraw()}
            onBack={() => setKey('')}
            onClose={close}
          />
        </View>
      ) : (
        <>
          <AccountPicker accounts={accounts} owner={shows.owner} chosen={account} onChoose={setAccountID} />
          <Field label="Amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <View style={{ gap: 8 }}>
            <Eyebrow>To your own bank</Eyebrow>
            {read ? (
              <Body muted>{read}</Body>
            ) : banks === null ? (
              <Body muted>Reading…</Body>
            ) : banks.length === 0 ? (
              <>
                <Body muted>No bank of your own yet.</Body>
                <Body muted>Add your own bank in Talyvor on the web.</Body>
              </>
            ) : (
              banks.map((p) => <AccountChoice key={p.id} name={bankLine(p)} balance="" chosen={p.id === bank?.id} onPress={() => setPayeeID(p.id)} />)
            )}
          </View>
          <FormButtons why={why} onContinue={() => setKey(Crypto.randomUUID())} onClose={close} />
        </>
      )}
      </SheetBody>
    </BottomSheet>
  )
}

/** Convert (Hybrid only): a currency for USDC or USDC for a currency, quoted, then converted once, signed with this phone's key. */
function Convert({ client, shows, accounts: all, hasKey, open, onClose, onDone }: SheetProps & { open: boolean }) {
  const accounts = companyAccounts(all, shows)
  const held = [...new Set(accounts.map((a) => a.currency))]
  const [sell, setSell] = useState('')
  const [buy, setBuy] = useState('')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<SideConversion | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const from = sell || held.find((c) => !isStablecoin(c)) || held[0] || 'USD'
  const targets = held.filter((c) => isStablecoin(c) !== isStablecoin(from))
  const to = targets.includes(buy) ? buy : (targets[0] ?? '')
  const minor = amountMinor(amount, from)
  const why = targets.length === 0 ? 'Open an account on the other side first.' : minor === null ? 'Add an amount first.' : undefined
  const balance = (currency: string) => formatMinor(accounts.filter((a) => a.currency === currency).reduce((s, a) => s + a.live_minor, 0), currency)
  const close = () => {
    if (busy) return
    setQuote(null)
    setAmount('')
    setRefusal('')
    onClose()
  }
  const ask = async () => {
    setBusy(true)
    setRefusal('')
    try {
      setQuote(await client.sideConvertQuote({ sell_currency: from, buy_currency: to, sell_minor: minor! }))
      setKey(Crypto.randomUUID())
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  const convert = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const { challenge } = await client.sideConvertChallenge(quote!.id, key)
      const assertion = await sign(client, challenge, `Convert ${formatMinor(quote!.sell_minor, quote!.sell_currency)}`)
      if (typeof assertion === 'string') return setRefusal(assertion)
      await client.sideConvert(quote!.id, key, assertion)
      setQuote(null)
      setAmount('')
      onDone()
      onClose()
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  const currencyChoice = (c: string, chosen: boolean, onPress: () => void) => <AccountChoice key={c} name={CURRENCY_NAME[c] ?? c} balance={balance(c)} chosen={chosen} onPress={onPress} />
  return (
    <BottomSheet visible={open} onClose={close} testID="convert">
      <SheetBody>
      <Headline>Convert</Headline>
      {held.length === 0 ? (
        <Body muted>{NO_ACCOUNT}</Body>
      ) : quote ? (
        <View style={{ gap: 12 }} testID="convert-confirm">
          <Figure size={28}>{formatMinor(quote.buy_minor, quote.buy_currency)}</Figure>
          <Facts
            facts={[
              ['You convert', <Figure key="sell">{formatMinor(quote.sell_minor, quote.sell_currency)}</Figure>],
              ['Rate', rateText(quote.rate, quote.sell_currency, quote.buy_currency)],
              ['Fee', <Figure key="fee">{formatMinor(quote.margin_minor, quote.sell_currency)}</Figure>],
              ['You get', <Figure key="buy">{formatMinor(quote.buy_minor, quote.buy_currency)}</Figure>],
            ]}
          />
          <ConfirmButtons
            label="Convert"
            busy={busy}
            busyLabel="Converting…"
            hasKey={hasKey}
            refusal={refusal}
            guards={`${biometricName === 'Face ID' ? 'Face ID asks' : 'Your fingerprint is asked for'} before anything is converted.`}
            onConfirm={() => void convert()}
            onBack={() => {
              setQuote(null)
              setRefusal('')
            }}
            onClose={close}
          />
        </View>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <Eyebrow>From</Eyebrow>
            {held.map((c) =>
              currencyChoice(c, c === from, () => {
                setSell(c)
                setBuy('')
              }),
            )}
          </View>
          <View style={{ gap: 8 }}>
            <Eyebrow>To</Eyebrow>
            {targets.map((c) => currencyChoice(c, c === to, () => setBuy(c)))}
          </View>
          <Field label="Amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <FormButtons why={why} busy={busy} busyLabel="Getting your quote…" onContinue={() => void ask()} onClose={close} />
          {refusal ? <RefusalLine text={refusal} /> : null}
        </>
      )}
      </SheetBody>
    </BottomSheet>
  )
}

function RefusalLine({ text }: { text: string }) {
  const { c } = useTheme()
  return <Body style={{ color: c.danger }}>{text}</Body>
}
