import {
  BffError,
  amountMinor,
  formatMinor,
  refusalText,
  type Agent,
  type AgentMoneyWallet,
  type AgentWallets,
  type CryptoAddress,
  type CryptoPayRequest,
  type CryptoSend,
  type CryptoSendQuote,
  type CryptoSendRequest,
  type OutsidePayee,
  type SpendPermission,
  type TokenLimit,
  type WalletLine,
  type WalletMove,
  type WalletMoveRoute,
} from '@talyvor/bff-client'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import { Children, cloneElement, isValidElement, useCallback, useState, type ReactElement, type ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import { encode } from 'uqr'

import { useAccount, type Shows } from '@/account'
import { approveCryptoSendSigned, biometricName, confirmWalletMove, keyGone, keyGoneText, sendCryptoSigned, signSpendPermission } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

import { Face } from './face'
import { Icon, type IconName } from './icon'
import { Money } from './money'
import { MONEY_WALLET, MoneyHeader } from './money-label'
import { Press } from './press'
import { Body, Button, Card, Chip, Eyebrow, Field, Figure, Headline, Row, useLoad } from './ui'

// B48.20 — an agent's wallets on the phone, as the web's wallet panel draws them (talyvor-suite B48.18, B48.36, B48.47
// and B48.48, with the web's words): each wallet's balance and how to pay into it, with the address's QR code; then, for
// its USDC wallet, Top up and Cash out (each quoted, then confirmed once), Send, Request a payment as a link and QR code,
// Activity with explorer links, and Limits and permissions. The owner's signatures come from this phone's key behind
// Face ID or a fingerprint: a cash-out or convert over Lens's challenge for exactly that move (B48.42), and new limits
// or Freeze over the permission's canonical JSON when this phone's key owns the agent's account (B48.3). B48.51: a send
// takes a name.eth or a name the owner saved an address under, and its quote shows the address it resolved to; the
// owner's send, and their yes to an agent's send to a new address, are signed by this phone's key over Lens's challenge
// for exactly that send (Lens B48.49).

export type WalletAction = 'top-up' | 'cash-out' | 'send' | 'request' | 'activity' | 'limits'

const ACTION_WORDS: Record<WalletAction, string> = {
  'top-up': 'Top up',
  'cash-out': 'Cash out',
  send: 'Send',
  request: 'Request',
  activity: 'Activity',
  limits: 'Limits and permissions',
}

/** The networks agents send and are paid on. Lens refuses one it does not serve here. */
const NETWORKS: { value: string; name: string }[] = [
  { value: 'base', name: 'Base' },
  { value: 'base-sepolia', name: 'Base Sepolia' },
]
const networkName = (n: string) => NETWORKS.find((x) => x.value === n.toLowerCase())?.name ?? n

/** USDC's contract on Base, as Circle publishes it: the token agents' wallets hold. */
export const USDC_ON_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const newKey = () => Crypto.randomUUID()
const usdcMinor = (text: string) => amountMinor(text, 'USDC')
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim())
/** biometricName at the start of a sentence: “Your fingerprint” on Android. */
const Biometric = biometricName[0].toUpperCase() + biometricName.slice(1)
const shortAddress = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Wei as the network's coin, to at most six decimals, rounded up: "0.000042 ETH". */
export function feeText(wei: string): string {
  let n: bigint
  try {
    n = BigInt(wei || '0')
  } catch {
    return 'Not known'
  }
  const whole = n / 10n ** 18n
  const micro = (n % 10n ** 18n) / 10n ** 12n + (n % 10n ** 12n > 0n ? 1n : 0n)
  const frac = micro.toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole}${frac ? `.${frac}` : ''} ETH`
}

function arrivalText(seconds?: number): string {
  if (!seconds) return 'when the network confirms it'
  return seconds < 90 ? `in about ${seconds} seconds` : `in about ${Math.round(seconds / 60)} minutes`
}

/** Where a network's transactions are shown. */
const EXPLORERS: Record<string, string> = { base: 'https://basescan.org', 'base-sepolia': 'https://sepolia.basescan.org' }
/** A transaction on its network's explorer, only ever at one of EXPLORERS; null for anything else. Never a URL Lens or
 * anyone else wrote: the phone opens no address it was given (security.test.tsx). */
export function explorerUrl(network: string, tx: string): string | null {
  return Object.hasOwn(EXPLORERS, network) && /^0x[0-9a-fA-F]{64}$/.test(tx) ? `${EXPLORERS[network]}/tx/${tx}` : null
}
/** A payment on a chain, on its network's explorer; null for a posting that is not on one. */
export function explorerLink(l: Pick<WalletLine, 'account_name' | 'ref'>): string | null {
  return explorerUrl(l.account_name.startsWith('chain:') ? l.account_name.slice('chain:'.length) : '', (l.ref ?? '').split(':')[0])
}
const openExplorer = (url: string | null) => (url ? () => void Linking.openURL(url) : undefined)

/** What went wrong, in the person's words: a key Face ID changed, a cancelled check, or Lens's sentence. */
function failure(err: unknown, nothing: string): string {
  if (keyGone(err)) return keyGoneText
  if (err instanceof BffError) return err.status < 500 ? refusalText(err) : `There was no answer. ${nothing}`
  return err instanceof Error && err.message ? err.message : nothing
}

/** The QR code of text, dark on light whatever the theme, so every camera reads it. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { border: 2 })
  const path = data.flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x} ${y}h1v1h-1z`] : []))).join('')
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} testID="wallet-qr" style={{ alignSelf: 'center', borderRadius: 12, overflow: 'hidden' }}>
      <Svg width={176} height={176} viewBox={`0 0 ${size} ${size}`}>
        <Rect width={size} height={size} fill="#FFFFFF" />
        <Path d={path} fill="#0B0B0F" />
      </Svg>
    </View>
  )
}

/** B57.220 — Pocket's facts box: a cloud box of rows, a rule between them. */
function Facts({ children, testID }: { children: ReactNode; testID?: string }) {
  const { c } = useTheme()
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<{ first?: boolean }>[]
  return (
    <View testID={testID} style={{ backgroundColor: c.cloud, borderRadius: 16, paddingHorizontal: 14 }}>
      {rows.map((r, i) => cloneElement(r, { first: i === 0 }))}
    </View>
  )
}

/** One fact: its name on the left, its value on the right, and Copy beside it when it is something to paste. */
function Fact({ name, value, copy, first }: { name: string; value: string; copy?: boolean; first?: boolean }) {
  const { c } = useTheme()
  const [copied, setCopied] = useState(false)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3, flexShrink: 0 }}>
        {name}
      </Text>
      <Text selectable style={{ flex: 1, minWidth: 0, fontFamily: fonts.uiMedium, fontSize: 14, color: c.ink, textAlign: 'right' }}>
        {value}
      </Text>
      {copy ? (
        <Press
          kind="round"
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Copied' : `Copy ${name.replace(/^[A-Z][a-z]/, (x) => x.toLowerCase())}`}
          hitSlop={8}
          onPress={() => void Clipboard.setStringAsync(value).then(() => setCopied(true))}
          style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.page, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={copied ? 'check' : 'copy'} color={c.ink} size={18} />
        </Press>
      ) : null}
    </View>
  )
}

/** A choice of a few, as Pocket's segmented buttons: the chosen one filled. */
function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; name: string }[]; value: T; onChange: (v: T) => void }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink2 }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => (
          <Button key={o.value} small variant={o.value === value ? 'primary' : 'outline'} label={o.name} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  )
}

/** How to add money: the address and its QR code, or the IBAN and its holder; nothing to copy while there are none. */
function AddMoney({ agent, wallet, shows }: { agent: Agent; wallet: AgentMoneyWallet; shows: Shows }) {
  const r = { ...wallet.receive, address: shows.onChain ? wallet.receive.address : undefined, iban: shows.bankTransfers ? wallet.receive.iban : undefined }
  if (wallet.mode !== 'LIVE' || (!r.address && !r.iban)) {
    return <Body muted>{wallet.notice || `${agent.name}’s wallet has no details to pay into yet.`}</Body>
  }
  if (r.address) {
    const network = r.network ? networkName(r.network) : ''
    return (
      <View style={{ gap: 10 }} testID="wallet-address">
        <QrCode text={r.address} label={`QR code of ${agent.name}’s ${r.asset} address`} />
        <Body>{`Send ${r.asset}${network ? ` on ${network}` : ''} to this address. Money sent on another network is lost.`}</Body>
        <Facts testID="wallet-address-facts">
          <Fact name="Address" value={r.address} copy />
          {network ? <Fact name="Network" value={network} /> : null}
        </Facts>
      </View>
    )
  }
  return (
    <View style={{ gap: 6 }} testID="wallet-iban">
      <Body>Pay in from your own bank with these details.</Body>
      <Facts>
        {r.holder ? <Fact name="Account holder" value={r.holder} copy /> : null}
        <Fact name="IBAN" value={r.iban ?? ''} copy />
        {r.bic ? <Fact name="BIC" value={r.bic} copy /> : null}
        {wallet.payment_reference ? <Fact name="Reference" value={wallet.payment_reference} copy /> : null}
      </Facts>
    </View>
  )
}

/** What a quoted move costs and brings, then Confirm; a cash-out or convert is signed with this phone's key first. */
function MoveQuote({ agent, m, gets, onChange, onDone }: { agent: Agent; m: WalletMove; gets: string; onChange: () => void; onDone: (m: WalletMove) => void }) {
  const { client } = useSession()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const signs = m.route === 'cash_out' || m.route === 'convert'
  const confirm = async () => {
    setBusy(true)
    setSaid('')
    try {
      const reason = m.route === 'cash_out' ? `Cash out ${formatMinor(m.sell_minor, m.sell_currency)}` : `Add ${formatMinor(m.buy_minor, m.buy_currency)} to ${agent.name}`
      onDone(await confirmWalletMove(client, agent.id, m, reason))
    } catch (err) {
      setSaid(
        err instanceof BffError && err.status === 409
          ? `${refusalText(err)} Ask for a new quote.`
          : failure(err, 'Press Confirm again: it is made once, however many times you press.'),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 10 }} testID="wallet-move-quote">
      <Facts>
        <Fact name={m.route === 'cash_out' ? 'You sell' : 'You pay'} value={formatMinor(m.sell_minor, m.sell_currency)} />
        <Fact name="Fee" value={formatMinor(m.fee_minor, m.sell_currency)} />
        {m.sell_currency === m.buy_currency ? null : <Fact name="Rate" value={`1 ${m.sell_currency} = ${m.rate} ${m.buy_currency}`} />}
        <Fact name={gets} value={formatMinor(m.buy_minor, m.buy_currency)} />
        {m.expires_at ? <Fact name="Price held until" value={when(m.expires_at)} /> : null}
      </Facts>
      {signs ? <Body muted>{`${Biometric} asks before anything moves.`}</Body> : null}
      <Button primary label={busy ? 'Confirming…' : signs ? `Confirm with ${biometricName}` : 'Confirm'} icon={signs ? 'faceid' : undefined} disabled={busy} hint="Confirming…" onPress={() => void confirm()} />
      <Button variant="secondary" label="Change" disabled={busy} hint="Confirming…" onPress={onChange} />
      {said ? <Body>{said}</Body> : null}
    </View>
  )
}

/** Where a confirmed move stands, in one sentence. */
function moveDone(agent: Agent, m: WalletMove): string {
  if (m.status !== 'posted') return m.detail || 'This is held while the partner finishes it. It shows here until it ends.'
  return m.route === 'cash_out'
    ? `Cashed out: ${formatMinor(m.buy_minor, m.buy_currency)} is on its way to your bank account.`
    : `Added: ${formatMinor(m.buy_minor, m.buy_currency)} is in ${agent.name}’s wallet.`
}

const TOP_UP_ROUTES: { value: Exclude<WalletMoveRoute, 'cash_out'>; name: string }[] = [
  { value: 'card', name: 'Card' },
  { value: 'bank_transfer', name: 'Bank transfer' },
  { value: 'convert', name: 'From your pounds, euros or dollars' },
  { value: 'wallet', name: 'From your own USDC' },
]
const FIAT = ['GBP', 'EUR', 'USD'] as const

/** Top up one wallet: how, how much, the quote, Confirm. */
function TopUp({ agent, wallet }: { agent: Agent; wallet: AgentMoneyWallet }) {
  const { client } = useSession()
  const routes = wallet.asset === 'USDC' ? TOP_UP_ROUTES : TOP_UP_ROUTES.filter((r) => r.value === 'wallet')
  const [route, setRoute] = useState(routes[0].value)
  const [currency, setCurrency] = useState<(typeof FIAT)[number]>('GBP')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<WalletMove | null>(null)
  const [done, setDone] = useState('')
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const sells = route === 'wallet' ? wallet.asset : currency
  const minor = amountMinor(amount, sells)
  const review = async () => {
    if (minor === null) return
    setBusy(true)
    setSaid('')
    try {
      setDone('')
      setQuote(await client.walletMoveQuote(agent.id, { route, amount_minor: minor, currency: sells }))
    } catch (err) {
      setSaid(failure(err, 'Nothing moved. You can try again.'))
    } finally {
      setBusy(false)
    }
  }
  if (quote) {
    return (
      <MoveQuote
        agent={agent}
        m={quote}
        gets={`${agent.name} gets`}
        onChange={() => setQuote(null)}
        onDone={(m) => {
          setQuote(null)
          setAmount('')
          setDone(moveDone(agent, m))
        }}
      />
    )
  }
  return (
    <View style={{ gap: 12 }} testID="wallet-top-up">
      {routes.length > 1 ? <Choice label="How" options={routes} value={route} onChange={setRoute} /> : null}
      {route !== 'wallet' ? <Choice label="Pay in" options={FIAT.map((x) => ({ value: x, name: x }))} value={currency} onChange={setCurrency} /> : null}
      <Field label={`Amount in ${sells}`} keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} />
      <Button primary label={busy ? 'Reading the quote…' : 'Review'} disabled={busy || minor === null} hint={minor === null ? 'Type an amount first' : 'Reading the quote…'} onPress={() => void review()} />
      {said ? <Body>{said}</Body> : null}
      {done ? <Body>{done}</Body> : null}
    </View>
  )
}

const payeeCurrency = (p: OutsidePayee) => (p.routing_number ? 'USD' : p.iban && !/^GB/i.test(p.iban) ? 'EUR' : 'GBP')

/** Cash out the USDC wallet to one of the owner's own bank accounts. */
function CashOut({ agent }: { agent: Agent }) {
  const { client } = useSession()
  const read = useLoad(useCallback(async () => ((await client.payees()).payees ?? []).filter((p) => !p.needs_confirmation && !p.address), [client]))
  const payees: OutsidePayee[] | null = read.data
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<WalletMove | null>(null)
  const [done, setDone] = useState('')
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const payee = payees?.find((p) => p.id === payeeID)
  const minor = usdcMinor(amount)
  if (read.error) return <Body>{failure(read.error, 'Your saved payees could not be read.')}</Body>
  if (payees === null) return <Body muted>Reading…</Body>
  if (payees.length === 0) return <Body>Save your own bank account as a payee on the Pay screen first, then cash out here.</Body>
  const review = async () => {
    if (!payee || minor === null) return
    setBusy(true)
    setSaid('')
    try {
      setDone('')
      setQuote(await client.walletMoveQuote(agent.id, { route: 'cash_out', amount_minor: minor, currency: 'USDC', payee_id: payee.id, to_currency: payeeCurrency(payee) }))
    } catch (err) {
      setSaid(failure(err, 'Nothing moved. You can try again.'))
    } finally {
      setBusy(false)
    }
  }
  if (quote) {
    return (
      <MoveQuote
        agent={agent}
        m={quote}
        gets={`${payee?.name ?? 'Your bank account'} gets`}
        onChange={() => setQuote(null)}
        onDone={(m) => {
          setQuote(null)
          setAmount('')
          setDone(moveDone(agent, m))
        }}
      />
    )
  }
  return (
    <View style={{ gap: 12 }} testID="wallet-cash-out">
      <Choice label="To your bank account" options={payees.map((p) => ({ value: p.id, name: p.name }))} value={payeeID} onChange={setPayeeID} />
      <Field label="Amount in USDC" keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} />
      <Button
        primary
        label={busy ? 'Reading the quote…' : 'Review'}
        disabled={busy || !payee || minor === null}
        hint={!payee || minor === null ? 'Choose your bank account and type an amount first' : 'Reading the quote…'}
        onPress={() => void review()}
      />
      {said ? <Body>{said}</Body> : null}
      {done ? <Body>{done}</Body> : null}
    </View>
  )
}

const SEND_STATUS: Record<CryptoSend['status'], [string, 'good' | 'bad' | 'wait']> = {
  awaiting_owner: ['Waiting for you', 'wait'],
  sending: ['Sending', 'wait'],
  sent: ['Sent', 'wait'],
  landed: ['Arrived', 'good'],
  failed: ['Failed', 'bad'],
  refused: ['Refused', 'bad'],
}

/** The quote's facts: who it goes to, on which network, the most the fee can be, and what is sent. */
function SendFacts({ q, agent }: { q: CryptoSendQuote; agent: Agent }) {
  const named = !!(q.saved_name || q.ens_name)
  return (
    <Facts testID="crypto-send-quote">
      {named ? <Fact name="To" value={q.saved_name || q.ens_name || ''} /> : null}
      {named ? <Fact name="Address" value={q.to} /> : null}
      {named ? null : <Fact name="To" value={q.to_kind === 'agent' && q.to_label ? `${q.to} · ${q.to_label}` : q.to} />}
      <Fact name="Network" value={networkName(q.network)} />
      <Fact name="Network fee, at most" value={`${feeText(q.max_fee_wei)} · ${q.fee_paid_by === 'workspace_gas_budget' ? 'Paid from your network fee budget' : `Paid by ${agent.name}’s wallet`}`} />
      <Fact name="You send" value={formatMinor(q.amount_minor, 'USDC')} />
    </Facts>
  )
}

/** Who a send goes to, in the words Face ID shows: the saved or ENS name with its short address, or the address. */
const sendsTo = (q: Pick<CryptoSendQuote, 'to' | 'saved_name' | 'ens_name'>) =>
  q.saved_name || q.ens_name ? `${q.saved_name || q.ens_name} (${shortAddress(q.to)})` : shortAddress(q.to)

/** A send waiting for the owner: Approve, Send a test amount first, or Decline; a yes and a test amount are signed by
 * this phone's key behind Face ID over Lens's challenge for that answer, a decline moves nothing and is not. */
function AwaitingSend({ agent, s, onAnswered }: { agent: Agent; s: CryptoSend; onAnswered: () => void }) {
  const { client } = useSession()
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const testMinor = usdcMinor(test)
  const answer = async (approve: boolean, testAmount?: number) => {
    setBusy(true)
    setSaid('')
    try {
      if (approve) await approveCryptoSendSigned(client, agent.id, s, testAmount, `Send ${formatMinor(testAmount ?? s.amount_minor, 'USDC')} to ${sendsTo(s)}`)
      else await client.declineCryptoSend(agent.id, s.id)
      onAnswered()
    } catch (err) {
      setSaid(failure(err, 'Nothing changed. You can try again.'))
    } finally {
      setBusy(false)
    }
  }
  const named = s.saved_name || s.ens_name
  return (
    <Card white testID={`crypto-send-waiting-${s.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Face agent={agent} waiting size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Body style={{ fontFamily: fonts.uiMedium }}>{`${agent.name} wants to send to a new address`}</Body>
          <Money minor={s.amount_minor} currency="USDC" size={15} />
        </View>
      </View>
      <Facts testID={`crypto-send-waiting-${s.id}-to`}>
        <Fact name="To" value={named || s.to} />
        {named ? <Fact name="Address" value={s.to} /> : null}
        <Fact name="Network" value={networkName(s.network)} />
        <Fact name="Asked" value={when(s.created_at)} />
      </Facts>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button small primary icon="faceid" label="Approve" accessibilityLabel={`Approve with ${biometricName}`} disabled={busy} hint="Answering…" onPress={() => void answer(true)} />
        <Button small variant="secondary" label="Send a test amount first" disabled={busy} hint="Answering…" onPress={() => setTesting((t) => !t)} />
        <Button small variant="danger" haptic={false} label="Decline" disabled={busy} hint="Answering…" onPress={() => void answer(false)} />
      </View>
      {testing ? (
        <View style={{ gap: 8 }}>
          <Field label="Test amount in USDC" keyboardType="decimal-pad" placeholder="0.10" value={test} onChangeText={setTest} />
          <Button
            small
            primary
            label="Send the test amount"
            disabled={busy || testMinor === null || testMinor >= s.amount_minor}
            hint={testMinor === null || testMinor >= s.amount_minor ? 'Type an amount less than the send first' : 'Answering…'}
            onPress={() => void answer(true, testMinor ?? undefined)}
          />
        </View>
      ) : null}
      {said ? <Body>{said}</Body> : null}
    </Card>
  )
}

/** B48.51 — the workspace's saved addresses: pressing one sends to it by its name; the owner saves and removes them. */
function SavedAddresses({ onPick }: { onPick: (name: string) => void }) {
  const { client } = useSession()
  const book = useLoad(useCallback(() => client.cryptoAddresses(), [client]))
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const act = async (what: () => Promise<unknown>, nothing: string) => {
    setBusy(true)
    setSaid('')
    try {
      await what()
      book.reload()
      return true
    } catch (err) {
      setSaid(failure(err, nothing))
      return false
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (await act(() => client.saveCryptoAddress(name.trim(), address.trim()), 'Nothing was saved. You can try again.')) {
      setName('')
      setAddress('')
    }
  }
  const saved = book.data
  return (
    <Card white testID="crypto-address-book">
      <Eyebrow>Saved addresses</Eyebrow>
      {book.error ? (
        <Body>{failure(book.error, 'Your saved addresses could not be read.')}</Body>
      ) : saved === null ? (
        <Body muted>Reading…</Body>
      ) : saved.length === 0 ? (
        <Body muted>No saved addresses yet.</Body>
      ) : (
        saved.map((a: CryptoAddress, i) => (
          <Row
            key={a.id}
            first={i === 0}
            left={<Initial of={a.name} testID={`crypto-address-${a.id}-initial`} />}
            title={a.name}
            sub={shortAddress(a.address)}
            onPress={() => onPick(a.name)}
            right={<Button small variant="secondary" haptic={false} label="Remove" accessibilityLabel={`Remove ${a.name}`} disabled={busy} hint="Removing…" onPress={() => void act(() => client.removeCryptoAddress(a.id), 'Nothing changed. You can try again.')} />}
          />
        ))
      )}
      <Field label="Name" placeholder="Treasury" value={name} onChangeText={setName} />
      <Field label="Address" placeholder="0x…" autoCapitalize="none" autoCorrect={false} value={address} onChangeText={setAddress} />
      <Button
        small
        variant="secondary"
        label="Save address"
        disabled={busy || !name.trim() || !isAddress(address)}
        hint={!name.trim() || !isAddress(address) ? 'Type a name and a 0x address first' : 'Saving…'}
        onPress={() => void save()}
      />
      {said ? <Body>{said}</Body> : null}
    </Card>
  )
}

/** A saved address's initial on its round tile, as w-members draws a person's; a send to no name wears its arrow. */
function Initial({ of, icon, testID }: { of: string; icon?: IconName; testID?: string }) {
  const { c } = useTheme()
  const letter = of.trim().charAt(0).toUpperCase()
  return (
    <View testID={testID} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud2 }}>
      {letter || !icon ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{letter || '?'}</Text> : <Icon name={icon} size={18} color={c.ink} />}
    </View>
  )
}

/** Send USDC: to an address, a name.eth, a saved name or a person → the quote, with the address it resolved to → Send,
 * signed with Face ID → the receipt; then what waits and what went. */
function Send({ agent }: { agent: Agent }) {
  const { client } = useSession()
  const [to, setTo] = useState('')
  const [network, setNetwork] = useState(NETWORKS[0].value)
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<CryptoSendQuote | null>(null)
  // One key per send, kept through every retry until Lens answers it.
  const [key, setKey] = useState(newKey)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [receipt, setReceipt] = useState<CryptoSend | null>(null)
  const list = useLoad(useCallback(async () => (await client.cryptoSends(agent.id)).sends ?? [], [agent.id, client]))
  const sends = list.data
  const reread = list.reload
  const readSaid = list.error ? failure(list.error, `${agent.name}’s sends could not be read.`) : ''
  const minor = usdcMinor(amount)
  const request = (): CryptoSendRequest => ({ to: to.trim(), network, token: 'USDC', amount_minor: minor ?? 0 })
  // A saved name is checked by Lens, which answers the address it names or nobody found.
  const ready = to.trim() !== '' && minor !== null
  const review = async () => {
    if (!ready) return
    setBusy(true)
    setSaid('')
    try {
      setReceipt(null)
      setQuote(await client.cryptoSendQuote(agent.id, request()))
    } catch (err) {
      setSaid(failure(err, 'Nothing was sent. You can try again.'))
    } finally {
      setBusy(false)
    }
  }
  const send = async () => {
    if (!quote) return
    setBusy(true)
    setSaid('')
    try {
      const s = await sendCryptoSigned(client, agent.id, request(), key, quote, `Send ${formatMinor(quote.amount_minor, 'USDC')} to ${sendsTo(quote)}`)
      setKey(newKey())
      setQuote(null)
      setAmount('')
      setReceipt(s)
      reread()
    } catch (err) {
      setSaid(failure(err, 'Press Send again: it is sent once, however many times you press.'))
    } finally {
      setBusy(false)
    }
  }
  const waiting = (sends ?? []).filter((s) => s.direction === 'out' && s.status === 'awaiting_owner')
  return (
    <View style={{ gap: 16 }} testID="wallet-send">
      <Card white testID="wallet-send-form">
        <Eyebrow>Send</Eyebrow>
        {quote ? (
          <View style={{ gap: 10 }}>
            <SendFacts q={quote} agent={agent} />
            <Chip>{`Arrives ${arrivalText(quote.arrival_seconds)}`}</Chip>
            {quote.new_address ? <Body muted>A new address: this workspace has not paid it before.</Body> : null}
            <Body muted>{`${Biometric} asks before anything is sent.`}</Body>
            <Button primary icon="faceid" label={busy ? 'Sending…' : `Send with ${biometricName}`} disabled={busy} hint="Sending…" onPress={() => void send()} />
            <Button
              variant="secondary"
              label="Change"
              disabled={busy}
              hint="Sending…"
              onPress={() => {
                setQuote(null)
                setSaid('')
              }}
            />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Field label="Wallet address, name.eth, saved name, @name, email or phone" placeholder="0x…, name.eth or @name" autoCapitalize="none" autoCorrect={false} value={to} onChangeText={setTo} />
            <Choice label="Network" options={NETWORKS} value={network} onChange={setNetwork} />
            <Field label="Amount in USDC" keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} />
            <Button primary label={busy ? 'Reading the quote…' : 'Review'} disabled={busy || !ready} hint={ready ? 'Reading the quote…' : 'Type who it goes to and an amount first'} onPress={() => void review()} />
          </View>
        )}
        {said ? <Body>{said}</Body> : null}
        {receipt ? (
          <View testID="crypto-send-receipt" style={{ gap: 6 }}>
            <Chip tone={SEND_STATUS[receipt.status][1]}>{SEND_STATUS[receipt.status][0]}</Chip>
            <Body>
              {receipt.status === 'awaiting_owner'
                ? 'A first send to a new address waits for the workspace’s owner.'
                : receipt.status === 'refused' || receipt.status === 'failed'
                  ? receipt.reason || 'Nothing was sent.'
                  : `${formatMinor(receipt.amount_minor, 'USDC')} to ${sendsTo(receipt)}.`}
            </Body>
          </View>
        ) : null}
      </Card>
      {waiting.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>Waiting for you</Eyebrow>
          {waiting.map((s) => (
            <AwaitingSend key={s.id} agent={agent} s={s} onAnswered={reread} />
          ))}
        </View>
      ) : null}
      {quote ? null : (
        <SavedAddresses
          onPick={(name) => {
            setTo(name)
            setSaid('')
          }}
        />
      )}
      <Card white testID="crypto-sends">
        <Eyebrow>Sent and received</Eyebrow>
        {readSaid ? (
          <Body>{readSaid}</Body>
        ) : sends === null ? (
          <Body muted>Reading…</Body>
        ) : sends.length === 0 ? (
          <Body muted>{`${agent.name} has not sent or been sent anything yet.`}</Body>
        ) : (
          sends.map((s, i) => (
            <Row
              key={s.id}
              first={i === 0}
              left={<Initial of={s.direction === 'in' ? '' : s.saved_name || s.ens_name || ''} icon={s.direction === 'in' ? 'arrowDown' : 'arrowUp'} />}
              title={s.direction === 'in' ? `From ${shortAddress(s.to)}` : `To ${s.saved_name || s.ens_name || shortAddress(s.to)}`}
              sub={`${SEND_STATUS[s.status][0]} · ${when(s.created_at)}`}
              right={<Figure>{`${s.direction === 'in' ? '+' : '−'}${formatMinor(s.amount_minor, 'USDC')}`}</Figure>}
              onPress={openExplorer(explorerUrl(s.network, s.tx_hash ?? ''))}
            />
          ))
        )}
      </Card>
    </View>
  )
}

const REQUEST_STATUS: Record<CryptoPayRequest['status'], [string, 'good' | 'bad' | 'wait']> = {
  open: ['Waiting', 'wait'],
  partial: ['Part paid', 'wait'],
  paid: ['Paid', 'good'],
  overpaid: ['Paid more', 'good'],
  expired: ['Expired', 'bad'],
}
const EXPIRES: { value: '1' | '7' | '30'; name: string }[] = [
  { value: '1', name: 'In a day' },
  { value: '7', name: 'In a week' },
  { value: '30', name: 'In 30 days' },
]

/** Ask to be paid USDC into the agent's wallet: a link and a QR code anyone can pay, then the requests and where they stand. */
function Request({ agent }: { agent: Agent }) {
  const { client } = useSession()
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [days, setDays] = useState<'1' | '7' | '30'>('7')
  const [key, setKey] = useState(newKey)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [made, setMade] = useState<CryptoPayRequest | null>(null)
  const read = useLoad(useCallback(async () => (await client.cryptoRequests(agent.id)).requests ?? [], [agent.id, client]))
  const list = read.data
  const reread = read.reload
  const readSaid = read.error ? failure(read.error, `${agent.name}’s requests could not be read.`) : ''
  const minor = usdcMinor(amount)
  const ready = minor !== null && memo.trim() !== ''
  const make = async () => {
    if (!ready) return
    setBusy(true)
    setSaid('')
    try {
      const expires = new Date(Date.now() + Number(days) * 86_400_000).toISOString()
      setMade(await client.cryptoRequest(agent.id, { token: 'USDC', network: 'base', amount_minor: minor, memo: memo.trim(), expires_at: expires }, key))
      setKey(newKey())
      setAmount('')
      setMemo('')
      reread()
    } catch (err) {
      setSaid(failure(err, 'No link was made. You can try again.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 12 }} testID="wallet-request">
      <Field label="Amount in USDC" keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} />
      <Field label="What it is for" placeholder="What the payer sees" value={memo} onChangeText={setMemo} />
      <Choice label="Expires" options={EXPIRES} value={days} onChange={setDays} />
      <Button primary label={busy ? 'Making the link…' : 'Make the link'} disabled={busy || !ready} hint={ready ? 'Making the link…' : 'Type an amount and what it is for first'} onPress={() => void make()} />
      {said ? <Body>{said}</Body> : null}
      {made ? (
        <View style={{ gap: 8 }} testID="wallet-request-link">
          <QrCode text={made.uri} label={`QR code to pay ${agent.name} ${made.memo}`} />
          <Body>{`Share this link, or have the payer scan the code. It asks for ${formatMinor(made.amount_minor, 'USDC')} on Base.`}</Body>
          <Facts>
            <Fact name="Link" value={made.link} copy />
          </Facts>
        </View>
      ) : null}
      <Eyebrow>Requests</Eyebrow>
      {readSaid ? (
        <Body>{readSaid}</Body>
      ) : list === null ? (
        <Body muted>Reading…</Body>
      ) : list.length === 0 ? (
        <Body muted>{`${agent.name} has not asked to be paid yet.`}</Body>
      ) : (
        list.map((r, i) => (
          <Row
            key={r.id}
            first={i === 0}
            title={r.memo || 'A request to be paid'}
            sub={`${REQUEST_STATUS[r.status][0]} · Expires ${when(r.expires_at)}`}
            right={<Text>{formatMinor(r.amount_minor, 'USDC')}</Text>}
          />
        ))
      )}
    </View>
  )
}

/** One wallet's postings, newest first; a payment on the chain opens its transaction on the explorer. */
function Activity({ agent, asset }: { agent: Agent; asset: string }) {
  const { client } = useSession()
  const read = useLoad(useCallback(async () => ((await client.walletActivity(agent.id)).lines ?? []).filter((l) => l.currency === asset), [agent.id, asset, client]))
  const lines = read.data
  if (read.error) return <Body>{failure(read.error, `${agent.name}’s activity could not be read.`)}</Body>
  if (lines === null) return <Body muted>Reading…</Body>
  if (lines.length === 0) return <Body muted>Nothing has gone into or out of this wallet yet. Press Top up to add money to it.</Body>
  return (
    <View testID={`wallet-activity-${asset}`}>
      {lines.map((l, i) => {
        const link = explorerLink(l)
        const who = l.counterparty && !l.counterparty.startsWith('workspace:') ? l.counterparty : l.amount_minor > 0 ? 'Money in' : 'Money out'
        return (
          <Row
            key={`${l.entry_id}:${l.line}`}
            first={i === 0}
            title={who}
            sub={`${when(l.at)}${l.memo ? ` · ${l.memo}` : ''}${link ? ' · See it on the explorer' : ''}`}
            right={<Text>{`${l.amount_minor > 0 ? '+' : '−'}${formatMinor(Math.abs(l.amount_minor), l.currency)}`}</Text>}
            onPress={openExplorer(link)}
          />
        )
      })}
    </View>
  )
}

const PERIOD_WORDS: Record<TokenLimit['period'], string> = { day: 'a day', week: 'a week', month: 'a month' }
const PERIODS: { value: TokenLimit['period']; name: string }[] = [
  { value: 'day', name: 'Day' },
  { value: 'week', name: 'Week' },
  { value: 'month', name: 'Month' },
]
const typed = (minor: number | undefined) => (minor ? String(minor / 1e6) : '')
const addresses = (text: string) => text.split(/[\s,]+/).filter(Boolean)
const listText = (xs: string[] | null | undefined) => (xs ?? []).join(', ')
const endText = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayOf = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '')

/** The agent's limits in force, and the form that signs new ones or freezes it, with this phone's key. */
function Limits({ agent }: { agent: Agent }) {
  const { client } = useSession()
  const read = useLoad(
    useCallback(
      () =>
        client.spendPermission(agent.id).then(
          (sp) => ({ sp }),
          (err: unknown) => {
            if (err instanceof BffError && err.status === 404) return { sp: null } // none signed yet
            throw err
          },
        ),
      [agent.id, client],
    ),
  )
  const [signed, setSigned] = useState<SpendPermission | null>(null)
  // Said here, not in the form: the form starts again on the permission it signed.
  const [done, setDone] = useState('')
  if (read.error) return <Body>{failure(read.error, `${agent.name}’s limits could not be read.`)}</Body>
  if (!read.data) return <Body muted>{`Reading ${agent.name}’s limits…`}</Body>
  const sp = signed ?? read.data.sp
  const tokens = sp?.permission.tokens ?? []
  return (
    <View style={{ gap: 12 }} testID="agent-wallet-limits">
      {sp === null ? (
        <Body>{`No limits are signed for ${agent.name} yet.`}</Body>
      ) : sp.frozen_at ? (
        <Body>{`${agent.name} is frozen: its wallet pays nothing.`}</Body>
      ) : tokens.length === 0 ? (
        <Body>{`${agent.name}’s wallet is frozen. Every payment from it is refused until you sign new limits.`}</Body>
      ) : (
        <Facts>
          {tokens.flatMap((l) => {
            const name = l.token === USDC_ON_BASE ? 'USDC on Base' : l.token
            const amount = (m: number) => (l.token === USDC_ON_BASE ? formatMinor(m, 'USDC') : `${m} units`)
            return [
              <Fact key={`${l.token}:allowance`} name={`Allowance, ${name}`} value={`${amount(l.allowance)} ${PERIOD_WORDS[l.period]}`} />,
              <Fact key={`${l.token}:per-payment`} name="Most in one payment" value={amount(l.per_payment)} />,
            ]
          })}
          <Fact name="Pays only" value={(sp.permission.allowed ?? []).length > 0 ? listText(sp.permission.allowed) : 'Any address it is not blocked from'} />
          {(sp.permission.blocked ?? []).length > 0 ? <Fact name="Never pays" value={listText(sp.permission.blocked)} /> : null}
          <Fact name="Ends" value={endText(sp.permission.expires)} />
          <Fact name="Signed" value={when(sp.signed_at)} />
        </Facts>
      )}
      {sp?.frozen_at ? null : (
        <LimitsForm
          key={sp?.number ?? 0}
          agent={agent}
          sp={sp}
          onSigned={(next) => {
            setSigned(next)
            setDone((next.permission.tokens ?? []).length > 0 ? `Signed. ${agent.name}’s new limits hold from now.` : '')
          }}
        />
      )}
      {done ? <Body>{done}</Body> : null}
    </View>
  )
}

function LimitsForm({ agent, sp, onSigned }: { agent: Agent; sp: SpendPermission | null; onSigned: (sp: SpendPermission) => void }) {
  const { client } = useSession()
  const p = sp?.permission
  const current = (p?.tokens ?? []).find((l) => l.token === USDC_ON_BASE)
  const others = (p?.tokens ?? []).filter((l) => l.token !== USDC_ON_BASE) // carried over as they are
  const [allowance, setAllowance] = useState(typed(current?.allowance))
  const [period, setPeriod] = useState<TokenLimit['period']>(current?.period ?? 'week')
  const [perPayment, setPerPayment] = useState(typed(current?.per_payment))
  const [allowed, setAllowed] = useState(listText(p?.allowed))
  const [blocked, setBlocked] = useState(listText(p?.blocked))
  const [ends, setEnds] = useState(dayOf(p?.expires))
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const allowanceMinor = usdcMinor(allowance)
  const perPaymentMinor = usdcMinor(perPayment)
  const endsOk = /^\d{4}-\d{2}-\d{2}$/.test(ends)
  // The end the owner did not change is signed exactly as it is; a new day ends at its last second, in UTC.
  const expires = !endsOk ? '' : ends === dayOf(p?.expires) && p ? p.expires : `${ends}T23:59:59Z`
  const ready = allowanceMinor !== null && perPaymentMinor !== null && expires !== ''
  const sign = async (tokens: TokenLimit[]) => {
    setBusy(true)
    setSaid('')
    try {
      const reason = tokens.length === 0 ? `Freeze ${agent.name}` : `Sign ${agent.name}’s new limits`
      const next = await signSpendPermission(client, agent.id, agent.name, { tokens, allowed: addresses(allowed), blocked: addresses(blocked), expires }, reason)
      onSigned(next)
    } catch (err) {
      setSaid(failure(err, 'Nothing changed. You can try again.'))
    } finally {
      setBusy(false)
    }
  }
  const limits = (): TokenLimit[] =>
    allowanceMinor !== null && perPaymentMinor !== null ? [{ token: USDC_ON_BASE, allowance: allowanceMinor, period, per_payment: perPaymentMinor }, ...others] : others
  return (
    <View style={{ gap: 12 }} testID="agent-wallet-limits-form">
      <Field label="Allowance in USDC" keyboardType="decimal-pad" placeholder="0.00" value={allowance} onChangeText={setAllowance} />
      <Choice label="Each" options={PERIODS} value={period} onChange={setPeriod} />
      <Field label="Most in one payment, in USDC" keyboardType="decimal-pad" placeholder="0.00" value={perPayment} onChangeText={setPerPayment} />
      <Field label="Pay only these addresses" placeholder="Any address, if you leave this empty" autoCapitalize="none" autoCorrect={false} value={allowed} onChangeText={setAllowed} />
      <Field label="Never pay these addresses" placeholder="0x…, 0x…" autoCapitalize="none" autoCorrect={false} value={blocked} onChangeText={setBlocked} />
      <Field label="Ends" placeholder="2027-06-30" autoCapitalize="none" value={ends} onChangeText={setEnds} />
      <Body muted>{`${Biometric} asks before anything changes.`}</Body>
      <Button
        primary
        icon="faceid"
        label={busy ? 'Signing…' : `Sign new limits with ${biometricName}`}
        disabled={busy || !ready}
        hint={ready ? 'Signing…' : 'Type an allowance, the most in one payment and when it ends first'}
        onPress={() => void sign(limits())}
      />
      {(p?.tokens ?? []).length > 0 ? (
        <Button
          variant="danger"
          haptic={false}
          label={`Freeze ${agent.name}`}
          disabled={busy || expires === ''}
          hint={expires === '' ? 'Choose when it ends first' : 'Signing…'}
          onPress={() => void sign([])}
        />
      ) : null}
      {said ? <Body>{said}</Body> : null}
    </View>
  )
}

// B57.220 — drawn in Pocket as p-agent-research and the launch pack's P4 draw money: the agent's face over its name, the
// balance as the figure in a cloud card with its label, the round actions under it (the one open filled), then how to
// add money in a facts box, and Activity and Limits and permissions as rows. A part opens under what opened it.
// B57.221 — Send is cards of its own: the form and its quote; each send waiting for the owner as p-approvals draws a
// request (the agent's face with its badge and the amount), who it goes to by name and address in facts; the saved
// addresses, each on its initial with Remove; and what went, each on its name's initial or its arrow.
const ROUND_ICON: Partial<Record<WalletAction, IconName>> = { 'top-up': 'plus', 'cash-out': 'arrowUp', send: 'send', request: 'arrowDown' }
const ROW_ICON: Partial<Record<WalletAction, IconName>> = { activity: 'clock', limits: 'sliders' }

/** One round action, as Pocket draws .qa: a circle over its word, filled while its part is open. */
function Round({ action, on, onPress }: { action: WalletAction; on: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Press
      kind="round"
      accessibilityRole="button"
      accessibilityLabel={ACTION_WORDS[action]}
      accessibilityState={{ expanded: on }}
      onPress={onPress}
      style={{ flex: 1, maxWidth: 84, alignItems: 'center', gap: 7 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: on ? c.primary : c.cloud, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={ROUND_ICON[action] ?? 'plus'} color={on ? c.onPrimary : c.ink} />
      </View>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: c.ink, textAlign: 'center' }}>{ACTION_WORDS[action]}</Text>
    </Press>
  )
}

/** One wallet: its balance, its actions, how to add money to it, and its activity and limits. */
function WalletPart({ agent, wallet, several, shows, opens }: { agent: Agent; wallet: AgentMoneyWallet; several: boolean; shows: Shows | null; opens?: WalletAction }) {
  const { c } = useTheme()
  const usdc = wallet.asset === 'USDC'
  const rounds: WalletAction[] = usdc ? ['top-up', 'cash-out', 'send', 'request'] : ['top-up']
  const rows: WalletAction[] = usdc ? ['activity', 'limits'] : ['activity']
  const [open, setOpen] = useState<WalletAction | null>(opens && [...rounds, ...rows].includes(opens) ? opens : null)
  const toggle = (a: WalletAction) => setOpen(open === a ? null : a)
  const network = wallet.receive.network ? networkName(wallet.receive.network) : ''
  // Send draws its own cards: the form, what waits for the owner, the saved addresses, and what went.
  const part = open === 'send' ? (
    <Send agent={agent} />
  ) : open ? (
    <Card white>
      <View style={{ gap: 12 }}>
        <Eyebrow>{ACTION_WORDS[open]}</Eyebrow>
        {open === 'top-up' ? <TopUp agent={agent} wallet={wallet} /> : null}
        {open === 'cash-out' ? <CashOut agent={agent} /> : null}
        {open === 'request' ? <Request agent={agent} /> : null}
        {open === 'activity' ? <Activity agent={agent} asset={wallet.asset} /> : null}
        {open === 'limits' ? <Limits agent={agent} /> : null}
      </View>
    </Card>
  ) : null
  return (
    <View style={{ gap: 16 }} testID={`agent-wallet-${wallet.asset}`}>
      <View testID={`agent-wallet-balance-${wallet.asset}`}>
        <Card>
          <MoneyHeader capability={MONEY_WALLET}>{several ? `Its ${wallet.asset} wallet` : 'Balance'}</MoneyHeader>
          <Money minor={wallet.balance_minor} currency={wallet.asset} size={44} />
          {network ? <Body muted>{`${wallet.asset} on ${network}`}</Body> : null}
        </Card>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around' }} testID={`agent-wallet-rounds-${wallet.asset}`}>
        {rounds.map((a) => (
          <Round key={a} action={a} on={open === a} onPress={() => toggle(a)} />
        ))}
      </View>
      {open && rounds.includes(open) ? part : null}
      <Card white>
        <View style={{ gap: 12 }}>
          <Eyebrow>Add money</Eyebrow>
          {shows ? <AddMoney agent={agent} wallet={wallet} shows={shows} /> : null}
        </View>
      </Card>
      <View testID={`agent-wallet-rows-${wallet.asset}`}>
        <Card white tight>
          {rows.map((a, i) => (
            <Row
              key={a}
              first={i === 0}
              left={<Icon name={ROW_ICON[a] ?? 'chev'} color={c.ink} />}
              title={ACTION_WORDS[a]}
              right={<Icon name={open === a ? 'x' : 'chev'} color={c.ink3} />}
              onPress={() => toggle(a)}
            />
          ))}
        </Card>
      </View>
      {open && rows.includes(open) ? part : null}
    </View>
  )
}

/** The agent's wallets: its face and name, then each wallet. */
export function AgentWalletView({ agent, wallets, opens }: { agent: Agent; wallets: AgentWallets; opens?: WalletAction }) {
  const { client } = useSession()
  const { shows } = useAccount(client)
  const all = wallets.wallets ?? []
  return (
    <View style={{ gap: 16 }} testID="agent-wallet">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} testID="agent-wallet-head">
        <Face agent={agent} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Headline>{`${agent.name}’s wallet`}</Headline>
        </View>
      </View>
      {all.length === 0 ? <Body>{`${agent.name} has no wallet yet.`}</Body> : null}
      {all.map((w) => (
        <WalletPart key={w.asset} agent={agent} wallet={w} several={all.length > 1} shows={shows} opens={opens} />
      ))}
    </View>
  )
}
