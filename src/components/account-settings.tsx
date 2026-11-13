import { formatMinor, type BffClient, type CurrencyAccount } from '@talyvor/bff-client'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { KIND_LABEL, KIND_LINE, TYPE_FIXED, TYPE_LABEL, type Account, type MoneyKind } from '../account'
import { fonts, useTheme } from '../theme'
import { isStablecoin } from './home'
import { Icon } from './icon'
import { Card, Chip, Eyebrow } from './ui'

// B57.138 — Settings' kind of money and account type as launch-pack P11 draws them, in the web's words and by the web's
// rule (suite B57.137, apps/web/src/areas/lens/AccountSettings.tsx; SPEC 3.5): every kind is a choice, the current one
// ringed with Current, and a single kind the account can't take yet says which balances must be zero and what that side
// holds now, each currency in its own figures, never a rate the phone made up. Hybrid can be taken at any time. Changing
// the kind is not built (B59.12), so the choices are read only; the phone draws no Building label (money-label.tsx).
// P11's "Convert or withdraw a balance" is left out: the phone has no screen yet that converts or withdraws a balance.

const KINDS: readonly MoneyKind[] = ['fiat', 'stablecoin', 'hybrid']

/** Each currency's total on one side of the account, company and agents together; only the ones that hold money. */
function held(accounts: readonly CurrencyAccount[], fiat: boolean): [string, number][] {
  const sums = new Map<string, number>()
  for (const a of accounts) {
    if (isStablecoin(a.currency) === fiat) continue
    sums.set(a.currency, (sums.get(a.currency) ?? 0) + a.balance_minor)
  }
  return [...sums].filter(([, minor]) => minor !== 0)
}

/** "$31,580.00", "£120.00 and €40.00". */
const heldText = (sums: [string, number][]) =>
  sums.map(([currency, minor], i) => `${i === 0 ? '' : i === sums.length - 1 ? ' and ' : ', '}${formatMinor(minor, currency)}`).join('')

/** P11's rule line: why a single kind can't be taken yet. `sums` is null while the balances are unread or unreadable. */
function ruleLine(fiatSide: boolean, sums: [string, number][] | null) {
  const rule = fiatSide ? 'Needs zero fiat balances.' : 'Needs zero stablecoin and crypto balances.'
  return sums && sums.length > 0 ? `${rule} They hold ${heldText(sums)}.` : rule
}

/** The company's and the agents' currency accounts; null until they are read, and if the read fails. */
function useHeld(client: BffClient): readonly CurrencyAccount[] | null {
  const [accounts, setAccounts] = useState<readonly CurrencyAccount[] | null>(null)
  useEffect(() => {
    let live = true
    client.moneyAccounts().then(
      (r) => live && setAccounts(r.accounts ?? []),
      () => live && setAccounts(null),
    )
    return () => {
      live = false
    }
  }, [client])
  return accounts
}

function KindChoices({ client, current }: { client: BffClient; current: MoneyKind }) {
  const { c } = useTheme()
  const accounts = useHeld(client)
  // A single kind needs the other side empty; an unread side is never assumed empty, so its rule stays, without a figure.
  const blockedBy = (k: MoneyKind): string | null => {
    if (k === 'hybrid' || k === current) return null
    const fiatSide = k === 'stablecoin'
    if (!accounts) return ruleLine(fiatSide, null)
    const sums = held(accounts, fiatSide)
    return sums.length === 0 ? null : ruleLine(fiatSide, sums)
  }
  return (
    <View testID="settings-money-kind" style={styles.kinds}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Kind of money" style={styles.kinds}>
        {KINDS.map((k) => {
          const on = k === current
          const blocked = blockedBy(k)
          return (
            <View
              key={k}
              accessible
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: !on }}
              style={[styles.choice, on ? { backgroundColor: c.page, borderColor: c.ink } : { backgroundColor: c.cloud, borderColor: c.cloud }]}>
              <View style={styles.choiceHead}>
                <View style={[styles.radio, on ? { backgroundColor: c.ink } : { backgroundColor: c.page, borderWidth: 1.5, borderColor: c.control }]}>
                  {on ? <View style={[styles.radioDot, { backgroundColor: c.page }]} /> : null}
                </View>
                <View style={styles.choiceWords}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, { color: c.ink }]}>{KIND_LABEL[k]}</Text>
                    {on ? <Chip>Current</Chip> : null}
                  </View>
                  <Text style={[styles.line, { color: c.ink2 }]}>{KIND_LINE[k]}</Text>
                </View>
              </View>
              {blocked ? (
                <View style={[styles.rule, styles.inset, { backgroundColor: c.page }]}>
                  <Icon name="lock" size={16} color={c.ink2} />
                  <Text style={[styles.line, styles.figures, { color: c.ink2, flex: 1 }]}>{blocked}</Text>
                </View>
              ) : null}
            </View>
          )
        })}
      </View>
      <View style={[styles.rule, { backgroundColor: c.cloud }]}>
        <Icon name="shield" size={18} color={c.ink2} />
        <Text style={[styles.line, { color: c.ink2, flex: 1 }]}>
          {current === 'hybrid'
            ? 'Hybrid can become a single kind only when the other side’s balances are zero.'
            : 'Fiat only or Stablecoin and crypto only can become Hybrid at any time.'}
        </Text>
      </View>
    </View>
  )
}

/** Settings' Account section: the kind of money as P11's choices, and the account's type, which can't be changed. */
export function AccountSettings({ client, account }: { client: BffClient; account: Account }) {
  const { c } = useTheme()
  return (
    <>
      <Eyebrow>Account</Eyebrow>
      <Text accessibilityRole="header" style={[styles.heading, { color: c.ink }]}>
        Kind of money
      </Text>
      <KindChoices client={client} current={account.money_kind} />
      <View testID="settings-account-type">
        <Card>
          <View style={styles.typeHead}>
            <Text accessibilityRole="header" style={[styles.title, { color: c.ink, flex: 1 }]}>
              Account type
            </Text>
            <Chip>{TYPE_LABEL[account.account_type]}</Chip>
          </View>
          <Text style={[styles.line, { color: c.ink2 }]}>{TYPE_FIXED}</Text>
        </Card>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  heading: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, letterSpacing: -0.3 },
  kinds: { gap: 10 },
  choice: { borderRadius: 18, borderWidth: 1.5, paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  choiceHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 7, height: 7, borderRadius: 4 },
  choiceWords: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.uiBold, fontSize: 16, lineHeight: 22 },
  line: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 },
  figures: { fontVariant: ['tabular-nums'] },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
  inset: { marginLeft: 32 },
  typeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
})
