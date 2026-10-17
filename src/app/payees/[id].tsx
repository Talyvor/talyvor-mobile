import { formatMinor, parseMinor, refusalText, type OutsidePayment } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { TextInput, View } from 'react-native'

import { Body, Button, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'
import { lastPaid, pinnedPayees, setPayeePinned, syncWidget } from '@/widget-sync'

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
  const payee = data?.payee
  const account = data?.accounts.find((a) => a.id === accountID) ?? data?.accounts[0]
  const minor = parseMinor(amount)
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
  const pay = () =>
    act(async () => {
      setMade(await client.pay({ account_id: account!.id, payee_id: payee!.id, amount_minor: minor!, currency: account!.currency, reference: reference.trim(), idempotency_key: key }))
      setAmount('')
      setReference('')
      setKey(Crypto.randomUUID())
    })
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
          <Body style={{ color: c.caution }}>Preview — test money only</Body>
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
            style={[input, { fontFamily: fonts.mono }]}
          />
          <TextInput
            accessibilityLabel="Reference"
            placeholder="Reference"
            placeholderTextColor={c.inkMuted}
            value={reference}
            onChangeText={typed(setReference)}
            style={[input, { fontFamily: fonts.ui }]}
          />
          <Button primary label="Pay" disabled={busy || held || !account || minor === null} onPress={() => void pay()} />
          {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
          {made ? <Body style={{ color: c.positive }}>{formatMinor(made.amount_minor, made.currency)} to {made.payee_name}: {made.status}.</Body> : null}
          <Eyebrow>Home-screen widget</Eyebrow>
          <Body muted>{data.pinned ? 'Pinned: it shows on your home-screen widget, and a tap opens this screen.' : 'Pin it to show it on your home-screen widget.'}</Body>
          <Button label={data.pinned ? 'Unpin from widget' : 'Pin to widget'} disabled={busy} onPress={() => void pin()} />
        </>
      ) : null}
    </Screen>
  )
}
