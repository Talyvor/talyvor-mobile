import { amountMinor, BffError, formatMinor, refusalText, type CurrencyAccount, type DeviceAssertion, type PersonPayment, type PersonPaymentRequest } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { accountName, useAccount } from '@/account'
import { Icon } from '@/components/icon'
import { foundName, Initials, NOBODY_FOUND, rememberPaid } from '@/components/pay-a-person'
import { AccountChoice, BottomSheet } from '@/components/pay-sheet'
import { Back, Body, Button, Card, Field, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { biometricName, forgetThisPhone, keyGone, keyGoneText, keysAvailable, phoneKey, signPersonPayment } from '@/keys'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B61.34 — Pay a person found on Pay (components/pay-a-person.tsx), as Pocket Live's phone `payAmount`, sheet `review`
// and `done` draw it, with the web's B61.33 words: the amount, the account it leaves (the account's own, never an
// agent's) and a note; one review; Send with Face ID over Lens's challenge naming exactly this payment; then Sent. The
// payment goes once under one key, renewed only after it is paid or when the payment changes, so a retry pays once.
// Lens decides everything else: the account it arrives in, the first payment's key, screening and freezes, each refusal
// in its own words.

/** "$42.00 to Dana R. It is there now.": a shown name ends with its initial's full stop, so none is added after it. */
const sentLine = (amount: string, who: string) => `${amount} to ${who}${who.endsWith('.') ? '' : '.'} It is there now.`

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

export default function PayPersonScreen() {
  const { to = '' } = useLocalSearchParams<{ to: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  const { shows } = useAccount(client)
  const owner = shows?.owner ?? 'The company'
  const load = useCallback(async () => {
    // The name is only ever Lens's: the one Find just answered, else Lens is asked again (a link carries no name).
    const [accounts, key, shown] = await Promise.all([
      client.moneyAccounts(),
      phoneKey(client).catch(() => null),
      foundName(to) ? Promise.resolve(foundName(to)) : client.findPerson(to).then((f) => f.shown_name, (err: unknown) => err),
    ])
    return {
      shown,
      accounts: (accounts.accounts ?? []).filter((a) => a.status === 'open' && a.purpose === 'company'),
      hasKey: !!key?.here && keysAvailable(),
    }
  }, [client, to])
  const { data, error, loading, reload } = useLoad(load)
  const [accountID, setAccountID] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [sent, setSent] = useState<PersonPayment | null>(null)
  const account: CurrencyAccount | undefined = data?.accounts.find((a) => a.id === accountID) ?? data?.accounts[0]
  const currency = account?.currency ?? ''
  const minor = currency ? amountMinor(amount, currency) : null
  const total = minor !== null ? formatMinor(minor, currency) : ''
  const name = typeof data?.shown === 'string' ? data.shown : ''
  const first = name.split(/\s+/)[0] || name

  // Another payment is another key: a retry of this one keeps it, so it is paid once.
  const [key, setKey] = useState(() => Crypto.randomUUID())
  const target = `${account?.id ?? ''} ${minor ?? ''} ${note.trim()}`
  const [keyFor, setKeyFor] = useState(target)
  if (keyFor !== target) {
    setKeyFor(target)
    setKey(Crypto.randomUUID())
  }

  const send = async () => {
    setBusy(true)
    setRefusal('')
    const payment: PersonPaymentRequest = { to, amount_minor: minor!, currency, account_id: account!.id, note: note.trim(), idempotency_key: key }
    let assertion: DeviceAssertion | null
    try {
      assertion = await signPersonPayment(client, payment, `Pay ${name} ${total}`)
    } catch (err) {
      setBusy(false)
      if (!keyGone(err)) return setRefusal(err instanceof BffError ? refusalText(err) : 'Nothing was paid.')
      // The dead key goes, so Approvals offers Turn on again.
      await forgetThisPhone().catch(() => undefined)
      return setRefusal(keyGoneText)
    }
    if (!assertion) {
      // The key went since the screen read it: the sheet offers Approvals on this phone.
      setBusy(false)
      reload()
      return
    }
    try {
      const paid = await client.payPerson(payment, assertion)
      await rememberPaid(client, { to, shown_name: paid.to_shown_name || name })
      setKey(Crypto.randomUUID())
      setReviewing(false)
      setSent(paid)
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Screen>
        <View testID="pay-a-person-sent" style={{ alignItems: 'center', gap: 10, paddingTop: 80 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: c.success50 }}>
            <Icon name="check" size={30} color={c.success} />
          </View>
          <Headline>Sent</Headline>
          <Body muted style={{ textAlign: 'center', maxWidth: 280 }}>{sentLine(formatMinor(sent.amount_minor, sent.currency), sent.to_shown_name || name)}</Body>
        </View>
        <Button primary label="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/pay'))} />
        <Button variant="ghost" label="See it in Activity" onPress={() => router.replace('/activity')} />
      </Screen>
    )
  }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/pay" />
      <LoadState loading={loading && !data} error={error} />
      {data && !name ? <Body>{data.shown instanceof BffError && data.shown.status === 404 ? data.shown.sentence || NOBODY_FOUND : refusalText(data.shown)}</Body> : null}
      {name ? (
        <>
          <Headline>{`Pay ${first}`}</Headline>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Initials name={name} size={56} />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: c.ink }}>{name}</Text>
            <Body muted>On Talyvor</Body>
          </View>
        </>
      ) : null}
      {data && name && !account ? <Body muted>You have no open account to pay from.</Body> : null}
      {data && name && account ? (
        <>
          <Field label={`Amount in ${currency}`} placeholder="0.00" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`From ${owner} · ${formatMinor(account.live_minor, currency)}`}
            onPress={() => setChoosing(true)}
            style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, height: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: c.cloud2 }}>
            <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13.5, color: c.ink }}>{`From ${owner} · ${formatMinor(account.live_minor, currency)}`}</Text>
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <Icon name="chev" size={14} color={c.ink2} />
            </View>
          </Pressable>
          <Field label="Note" placeholder={`What ${first} sees`} maxLength={140} value={note} onChangeText={setNote} />
          <Button
            primary
            label="Review"
            disabled={minor === null || minor <= 0}
            hint="Add an amount first."
            onPress={() => {
              setRefusal('')
              setReviewing(true)
            }}
          />
          <BottomSheet visible={choosing} onClose={() => setChoosing(false)}>
            <View testID="pay-a-person-from" style={{ gap: 10 }}>
              <Headline>Pay from</Headline>
              {data.accounts.map((a) => (
                <AccountChoice
                  key={a.id}
                  name={accountName(a, owner)}
                  balance={formatMinor(a.live_minor, a.currency)}
                  chosen={a.id === account.id}
                  onPress={() => {
                    setAccountID(a.id)
                    setChoosing(false)
                  }}
                />
              ))}
            </View>
          </BottomSheet>
          <BottomSheet visible={reviewing && minor !== null} onClose={busy ? undefined : () => setReviewing(false)}>
            <View testID="pay-a-person-review" style={{ gap: 12 }}>
              <Headline>Check and send</Headline>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Figure size={34}>{total}</Figure>
                <Body muted>{`to ${name}`}</Body>
              </View>
              <Facts
                facts={[
                  ['From', owner],
                  ['Arrives', 'In seconds'],
                  ['Fee', formatMinor(0, currency)],
                  ['They get', total],
                  ...(note.trim() ? ([['Note', note.trim()]] as [string, string][]) : []),
                ]}
              />
              {data.hasKey ? (
                <Button primary label={busy ? 'Sending…' : `Send with ${biometricName}`} disabled={busy} hint="Sending…" onPress={() => void send()} />
              ) : (
                <>
                  <Body muted>{`Turn on Approve with ${biometricName} on this phone first: Talyvor asks for ${biometricName} before each payment from this phone.`}</Body>
                  <Button
                    primary
                    label="Approvals on this phone"
                    onPress={() => {
                      setReviewing(false)
                      router.push('/approvals')
                    }}
                  />
                </>
              )}
              <Button variant="secondary" label="Change something" disabled={busy} hint="Sending…" onPress={() => setReviewing(false)} />
              {refusal ? <Body style={{ color: c.danger }}>{refusal}</Body> : null}
            </View>
          </BottomSheet>
        </>
      ) : null}
    </Screen>
  )
}
