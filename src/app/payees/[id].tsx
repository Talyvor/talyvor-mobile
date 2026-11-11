import { BffError, formatMinor, parseMinor, refusalText, type DeviceAssertion, type OutsidePayment } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Modal, Pressable, TextInput, View } from 'react-native'

import { Body, Button, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { biometricName, forgetThisPhone, keyGone, keyGoneText, signPayment } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'
import { lastPaid, pinnedPayees, setPayeePinned, syncWidget } from '@/widget-sync'

// The web's first-payment questions (talyvor-suite Pay.tsx SCAM_QUESTIONS).
const SCAM_QUESTIONS = [
  { key: 'urgent', text: 'Were you told to pay urgently?' },
  { key: 'details', text: 'Did the bank details arrive by email or chat?' },
] as const
type ScamAnswers = Partial<Record<(typeof SCAM_QUESTIONS)[number]['key'], boolean>>

/** What became of a payment, in words: Lens's pending | sent | completed | failed | returned. */
function outcome(p: OutsidePayment): string {
  const amount = formatMinor(p.amount_minor, p.currency)
  if (p.status === 'completed') return `Paid ${p.payee_name} ${amount}.`
  if (p.status === 'failed' || p.status === 'returned') return `${amount} to ${p.payee_name} was not paid${p.detail ? `: ${p.detail}` : ''}.`
  return `${amount} to ${p.payee_name} is on its way.`
}

/** Pay one saved payee from one of your accounts, and its place on the home-screen widget. */
export default function PayeeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [payees, payments, accounts, pins] = await Promise.all([client.payees(), client.payments(), client.moneyAccounts(), pinnedPayees()])
    return {
      payee: (payees.payees ?? []).find((p) => p.id === id) ?? null,
      payments: payments.payments ?? [],
      accounts: (accounts.accounts ?? []).filter((a) => a.status === 'open'),
      pinned: pins.includes(id),
    }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const [accountID, setAccountID] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  // One key per payment typed, so a retry after a dropped answer pays once.
  const [key, setKey] = useState(() => Crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [made, setMade] = useState<OutsidePayment | null>(null)
  // B55.25: Pay opens the confirm step; nothing is sent until Pay with Face ID passes the phone's check.
  const [confirming, setConfirming] = useState(false)
  const [answers, setAnswers] = useState<ScamAnswers>({})
  const [checked, setChecked] = useState(false)
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
  const shown = account && minor !== null ? formatMinor(minor, account.currency) : ''
  const first = !!payee && !data?.payments.some((p) => p.payee_id === payee.id)
  const warned = !!(answers.urgent || answers.details)
  const answered = !first || (SCAM_QUESTIONS.every((q) => answers[q.key] !== undefined) && (!warned || checked))
  const close = () => {
    setConfirming(false)
    setAnswers({})
    setChecked(false)
  }
  const open = () => {
    setRefusal('')
    setMade(null)
    setConfirming(true)
  }
  const confirm = async () => {
    setRefusal('')
    setBusy(true)
    const payment = { account_id: account!.id, payee_id: payee!.id, amount_minor: minor!, currency: account!.currency, reference: reference.trim(), idempotency_key: key }
    let assertion: DeviceAssertion | null
    try {
      assertion = await signPayment(client, payment, `Pay ${payee!.name} ${shown}`)
    } catch (err) {
      setBusy(false)
      if (!keyGone(err)) return setRefusal(err instanceof BffError ? refusalText(err) : 'Nothing was paid.')
      // The dead key goes, so Approvals offers Turn on again.
      await forgetThisPhone().catch(() => undefined)
      return setRefusal(keyGoneText)
    }
    setBusy(false)
    if (!assertion) return setRefusal(`Turn on Approve with ${biometricName} on this phone first: Talyvor asks for ${biometricName} before each payment from this phone.`)
    await act(async () => {
      setMade(await client.pay(payment, assertion))
      close()
      setAmount('')
      setReference('')
      setKey(Crypto.randomUUID())
    })
  }
  const pin = () => act(() => setPayeePinned(payee!.id, !data!.pinned))
  const held = payee?.needs_confirmation || !!payee?.screening
  const input = { borderWidth: 1, borderColor: c.lineStrong, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, color: c.ink, fontSize: 15 }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <LoadState loading={loading && !data} error={error} />
      {data && !payee ? <Body muted>This payee is not saved in your workspace.</Body> : null}
      {payee && data ? (
        <>
          <Eyebrow>Pay</Eyebrow>
          <Headline>{payee.name}</Headline>
          <Body muted>Last payment: {lastPaid(data.payments, payee.id)}</Body>
          {payee.needs_confirmation ? <Body style={{ color: c.caution }}>Confirm this payee with your passkey in Talyvor on the web before the first payment.</Body> : null}
          {payee.screening ? <Body style={{ color: c.caution }}>This payee is being checked, so it cannot be paid yet.</Body> : null}
          <Eyebrow>From</Eyebrow>
          {data.accounts.length === 0 ? <Body muted>You have no open account to pay from.</Body> : null}
          {data.accounts.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Button primary={a.id === account?.id} label={a.name || `${a.purpose === 'agent' ? 'Agent' : 'Company'} · ${a.currency}`} onPress={() => setAccountID(a.id)} />
              </View>
              <Figure>{formatMinor(a.balance_minor, a.currency)}</Figure>
            </View>
          ))}
          <Eyebrow>Amount</Eyebrow>
          <TextInput
            accessibilityLabel={`Amount in ${account?.currency ?? 'the account currency'}`}
            placeholder={`Amount in ${account?.currency ?? ''}`}
            placeholderTextColor={c.inkMuted}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={typed(setAmount)}
            style={[input, { fontFamily: fonts.ui }]}
          />
          <TextInput
            accessibilityLabel="Reference"
            placeholder="Reference"
            placeholderTextColor={c.inkMuted}
            value={reference}
            onChangeText={typed(setReference)}
            style={[input, { fontFamily: fonts.ui }]}
          />
          <Button primary label="Pay" disabled={busy || held || !account || minor === null} onPress={open} />
          {refusal && !confirming ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
          {made ? <Body style={{ color: made.status === 'failed' || made.status === 'returned' ? c.critical : c.positive }}>{outcome(made)}</Body> : null}
          <Modal visible={confirming && !!account} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
            <Screen>
              <Headline>
                Pay {payee.name} {shown}?
              </Headline>
              {[
                ['From', account ? account.name || `${account.purpose === 'agent' ? 'Agent' : 'Company'} · ${account.currency}` : ''],
                ['To', payee.name],
                ['Amount', shown],
                ['Reference', reference.trim() || 'None'],
              ].map(([label, value]) => (
                <View key={label}>
                  <Eyebrow>{label}</Eyebrow>
                  {label === 'Amount' ? <Figure>{value}</Figure> : <Body>{value}</Body>}
                </View>
              ))}
              {first
                ? SCAM_QUESTIONS.map((q) => (
                    <View key={q.key} style={{ gap: 8 }}>
                      <Body>{q.text}</Body>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        {([true, false] as const).map((yes) => (
                          <Pressable
                            key={String(yes)}
                            accessibilityRole="button"
                            accessibilityLabel={`${q.text} ${yes ? 'Yes' : 'No'}`}
                            accessibilityState={{ selected: answers[q.key] === yes }}
                            onPress={() => setAnswers((a) => ({ ...a, [q.key]: yes }))}
                            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderWidth: 1, borderRadius: 6, borderColor: answers[q.key] === yes ? c.accent : c.lineStrong, backgroundColor: answers[q.key] === yes ? c.accent : 'transparent' }}>
                            <Body style={{ color: answers[q.key] === yes ? c.onAccent : c.ink }}>{yes ? 'Yes' : 'No'}</Body>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))
                : null}
              {first && warned ? (
                <>
                  <Body style={{ color: c.caution }}>
                    {`Stop and check. This could be a scam. Fraudsters rush people into paying, and they send or change bank details by email or chat. Before you pay, call ${payee.name} on a number you already have, not one from the message, and check the details. Money sent to a fraudster is often not recovered.`}
                  </Body>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() => setChecked((v) => !v)}
                    style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                    <View style={{ width: 22, height: 22, borderWidth: 1, borderRadius: 4, borderColor: checked ? c.accent : c.lineStrong, backgroundColor: checked ? c.accent : 'transparent' }} />
                    <View style={{ flex: 1 }}>
                      <Body>{`I have checked the details with ${payee.name} directly and still want to pay.`}</Body>
                    </View>
                  </Pressable>
                </>
              ) : null}
              <Button primary label={`Pay with ${biometricName}`} disabled={busy || !answered} onPress={() => void confirm()} />
              <Button label="Cancel" disabled={busy} onPress={close} />
              {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
            </Screen>
          </Modal>
          <Eyebrow>Home-screen widget</Eyebrow>
          <Body muted>{data.pinned ? 'Pinned: it shows on your home-screen widget, and a tap opens this screen.' : 'Pin it to show it on your home-screen widget.'}</Body>
          <Button label={data.pinned ? 'Unpin from widget' : 'Pin to widget'} disabled={busy} onPress={() => void pin()} />
        </>
      ) : null}
    </Screen>
  )
}
