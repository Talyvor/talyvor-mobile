import {
  BffError,
  formatMinor,
  parseMinor,
  refusalText,
  type BffClient,
  type CurrencyAccount,
  type DeviceAssertion,
  type OutsidePayment,
  type PaymentRequest,
  type PaymentRequestItem,
} from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { Link, router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useCallback, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useAccount } from '@/account'
import { Icon } from '@/components/icon'
import { MoneyLabel, PAY_OUT } from '@/components/money-label'
import { AccountChoice, BottomSheet, ConfirmPayment } from '@/components/pay-sheet'
import { pendingPrepared, preparedBy } from '@/components/prepared-payment-card'
import { Body, Button, Card, Field, Headline, LoadState, Screen, Toggle, useLoad } from '@/components/ui'
import { forgetThisPhone, keyGone, keyGoneText, keysAvailable, phoneKey, signPayment } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'
import { lastPaid, pinnedPayees, setPayeePinned, syncWidget } from '@/widget-sync'

/** What became of a payment, in words: Lens's pending | sent | completed | failed | returned. */
function outcome(p: Pick<OutsidePayment, 'payee_name' | 'amount_minor' | 'currency' | 'status' | 'detail'>): string {
  const amount = formatMinor(p.amount_minor, p.currency)
  if (p.status === 'completed') return `Paid ${p.payee_name} ${amount}.`
  if (p.status === 'failed' || p.status === 'returned') return `${amount} to ${p.payee_name} was not paid${p.detail ? `: ${p.detail}` : ''}.`
  return `${amount} to ${p.payee_name} is on its way.`
}

const notPaid = (status: string) => status === 'failed' || status === 'returned'

// B59.11 — the owner's own account by the workspace's type, as the web's Pay names it: "Your account · GBP" for a Personal
// account, "The company · GBP" for a Business. An account given its own name, such as "Payroll · GBP", keeps it.
const accountName = (a: CurrencyAccount, owner: string) =>
  a.purpose === 'company' && (!a.name || a.name.startsWith('The company')) ? `${owner} · ${a.currency}` : a.name || `Agent · ${a.currency}`

// B57.72 — a prepared payment the payee screen saw waiting, by payee: Lens lists only the waiting ones, so once one is
// approved the screen reads it back by its id to say it is paid, on the day it last saw it waiting.
const PREPARED = 'talyvor.prepared-payees'
const PAY_FAILED = new Set(['failed', 'returned', 'refused', 'not_approved', 'not_paid', 'held'])

async function preparedToday(client: BffClient, payeeID: string, waiting: PaymentRequest | null): Promise<{ request: PaymentRequest; item: PaymentRequestItem } | null> {
  const seen = JSON.parse((await SecureStore.getItemAsync(PREPARED)) ?? '{}') as Record<string, { id: string; day: string }>
  const today = new Date().toDateString()
  if (waiting) {
    await SecureStore.setItemAsync(PREPARED, JSON.stringify({ ...seen, [payeeID]: { id: waiting.id, day: today } }))
    return null
  }
  const was = seen[payeeID]
  if (!was) return null
  const request = was.day === today ? await client.paymentRequest(was.id) : null
  const item = request?.status === 'approved' ? request.items.find((it) => it.payee_id === payeeID) : undefined
  if (request && item && !PAY_FAILED.has(item.pay_status ?? '')) return { request, item }
  delete seen[payeeID]
  await SecureStore.setItemAsync(PREPARED, JSON.stringify(seen))
  return null
}

/** Pay one saved payee from one of your accounts, and its place on the home-screen widget. */
export default function PayeeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [payees, payments, accounts, pins, key, prepared] = await Promise.all([
      client.payees(),
      client.payments(),
      client.moneyAccounts(),
      pinnedPayees(),
      phoneKey(client).catch(() => null),
      pendingPrepared(client),
    ])
    const waiting = prepared.find((r) => r.items.some((it) => it.payee_id === id)) ?? null
    return {
      payee: (payees.payees ?? []).find((p) => p.id === id) ?? null,
      payments: payments.payments ?? [],
      accounts: (accounts.accounts ?? []).filter((a) => a.status === 'open'),
      pinned: pins.includes(id),
      hasKey: !!key?.here && keysAvailable(),
      waiting,
      approved: await preparedToday(client, id, waiting),
    }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const { shows } = useAccount(client)
  const owner = shows?.owner ?? 'The company'
  // Back from a prepared payment's approval card, the screen reads again.
  const shown = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (shown.current) reload()
      shown.current = true
    }, [reload]),
  )
  const [accountID, setAccountID] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  // One key per payment typed, so a retry after a dropped answer pays once.
  const [key, setKey] = useState(() => Crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [made, setMade] = useState<{ payment: OutsidePayment; from: CurrencyAccount } | null>(null)
  // B55.25: Pay opens the confirm step; nothing is sent until Pay with Face ID passes the phone's check.
  const [confirming, setConfirming] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const payee = data?.payee
  const account = data?.accounts.find((a) => a.id === accountID) ?? data?.accounts[0]
  const minor = parseMinor(amount)
  // A new key for another payee or account too: Lens signs the key into the payment, so it names one payment exactly.
  const target = `${id} ${account?.id ?? ''}`
  const [keyFor, setKeyFor] = useState(target)
  if (keyFor !== target) {
    setKeyFor(target)
    setKey(Crypto.randomUUID())
  }
  const typed = (set: (v: string) => void) => (v: string) => {
    set(v)
    setMade(null)
    setKey(Crypto.randomUUID())
  }

  const act = async (write: () => Promise<unknown>) => {
    setBusy(true)
    setRefusal('')
    try {
      await write()
      reload()
      void syncWidget(client)
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  const total = account && minor !== null ? formatMinor(minor, account.currency) : ''
  const first = !!payee && !data?.payments.some((p) => p.payee_id === payee.id)
  const open = () => {
    setRefusal('')
    setMade(null)
    setConfirming(true)
  }
  const confirm = async () => {
    setRefusal('')
    setBusy(true)
    const from = account!
    const payment = { account_id: from.id, payee_id: payee!.id, amount_minor: minor!, currency: from.currency, reference: reference.trim(), idempotency_key: key }
    let assertion: DeviceAssertion | null
    try {
      assertion = await signPayment(client, payment, `Pay ${payee!.name} ${total}`)
    } catch (err) {
      setBusy(false)
      if (!keyGone(err)) return setRefusal(err instanceof BffError ? refusalText(err) : 'Nothing was paid.')
      // The dead key goes, so Approvals offers Turn on again.
      await forgetThisPhone().catch(() => undefined)
      return setRefusal(keyGoneText)
    }
    setBusy(false)
    if (!assertion) {
      // The key went since the screen read it: the step offers Approvals on this phone.
      reload()
      return
    }
    await act(async () => {
      setMade({ payment: await client.pay(payment, assertion), from })
      setConfirming(false)
      setAmount('')
      setReference('')
      setKey(Crypto.randomUUID())
    })
  }
  const pin = () => act(() => setPayeePinned(payee!.id, !data!.pinned))
  const held = payee?.needs_confirmation || !!payee?.screening
  const last = data && payee ? lastPaid(data.payments, payee.id) : ''
  const prepared = data?.approved
  const fieldLabel = { fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={10}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/pay'))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' }}>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <Icon name="chev" size={16} color={c.ink2} />
        </View>
        <Text style={{ fontFamily: fonts.uiMedium, fontSize: 15, color: c.ink2 }}>Back</Text>
      </Pressable>
      <LoadState loading={loading && !data} error={error} />
      {data && !payee ? <Body muted>This payee is not saved in your workspace.</Body> : null}
      {payee && data ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flexShrink: 1 }}>
              <Headline>{payee.name}</Headline>
            </View>
            <MoneyLabel capability={PAY_OUT} />
          </View>
          <Body muted>{last === 'Not paid yet' ? last : `Last payment: ${last}`}</Body>
          {payee.needs_confirmation ? <Body style={{ color: c.caution }}>Confirm this payee with your passkey in Talyvor on the web before the first payment.</Body> : null}
          {payee.screening ? <Body style={{ color: c.caution }}>This payee is being checked, so it cannot be paid yet.</Body> : null}
          <View style={{ gap: 6 }}>
            <Text style={fieldLabel}>From</Text>
            {account ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`From ${accountName(account, owner)}, ${formatMinor(account.balance_minor, account.currency)}`}
                onPress={() => setChoosing(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: c.control, paddingHorizontal: 14, backgroundColor: c.page }}>
                <Body style={{ flex: 1 }}>{accountName(account, owner)}</Body>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3, fontVariant: ['tabular-nums'] }}>{formatMinor(account.balance_minor, account.currency)}</Text>
                <View style={{ transform: [{ rotate: '90deg' }] }}>
                  <Icon name="chev" size={16} color={c.ink3} />
                </View>
              </Pressable>
            ) : (
              <Body muted>You have no open account to pay from.</Body>
            )}
          </View>
          <Field label={`Amount in ${account?.currency ?? 'the account currency'}`} keyboardType="decimal-pad" value={amount} onChangeText={typed(setAmount)} />
          <Field label="Reference" value={reference} onChangeText={typed(setReference)} />
          {data.waiting ? (
            <Card>
              <Body>{`${preparedBy(data.waiting.client)} prepared this payment, and it waits for you.`}</Body>
              <Link href={{ pathname: '/approve/[id]', params: { id: data.waiting.id } }} asChild>
                <Pressable
                  accessibilityRole="link"
                  style={({ pressed }) => [{ height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary }, pressed && { opacity: 0.6 }]}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: c.onPrimary }}>Review it</Text>
                </Pressable>
              </Link>
            </Card>
          ) : prepared ? (
            <Card>
              <Body style={{ fontFamily: fonts.uiBold }}>
                {outcome({ payee_name: payee.name, amount_minor: prepared.item.amount_minor, currency: prepared.item.currency, status: prepared.item.pay_status ?? 'pending' })}
              </Body>
              <Body muted>{`The payment ${preparedBy(prepared.request.client).replace(/^(Your|An|A) /, (w) => w.toLowerCase())} prepared, approved by you today.`}</Body>
            </Card>
          ) : made ? (
            <Card>
              <Body style={{ fontFamily: fonts.uiBold, color: notPaid(made.payment.status) ? c.danger : c.ink }}>{outcome(made.payment)}</Body>
              {notPaid(made.payment.status) ? null : (
                <Body muted>{`Sent today from ${made.from.purpose === 'company' ? (shows?.team === false ? 'your account' : 'the company’s account') : accountName(made.from, owner)}.`}</Body>
              )}
            </Card>
          ) : (
            <Button
              primary
              label={total ? `Pay ${total}` : 'Pay'}
              disabled={busy || held || !account || minor === null}
              hint={held ? 'This payee cannot be paid yet.' : !account ? 'You have no open account to pay from.' : 'Add an amount.'}
              onPress={open}
            />
          )}
          {refusal && !confirming ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
          <BottomSheet visible={choosing} onClose={() => setChoosing(false)}>
            <Headline>From</Headline>
            {data.accounts.map((a) => (
              <AccountChoice
                key={a.id}
                name={accountName(a, owner)}
                balance={formatMinor(a.balance_minor, a.currency)}
                chosen={a.id === account?.id}
                onPress={() => {
                  setAccountID(a.id)
                  setChoosing(false)
                }}
              />
            ))}
          </BottomSheet>
          <BottomSheet visible={confirming && !!account} onClose={() => !busy && setConfirming(false)}>
            {account ? (
              <ConfirmPayment
                payee={payee.name}
                from={accountName(account, owner)}
                amount={total}
                reference={reference.trim()}
                first={first}
                hasKey={data.hasKey}
                busy={busy}
                refusal={refusal}
                onPay={() => void confirm()}
                onCancel={() => setConfirming(false)}
                onApprovals={() => {
                  setConfirming(false)
                  router.push('/approvals')
                }}
              />
            ) : null}
          </BottomSheet>
          <Card>
            <Toggle label="Pinned to your home-screen widget" value={data.pinned} disabled={busy} onValueChange={() => void pin()} />
          </Card>
        </>
      ) : null}
    </Screen>
  )
}
