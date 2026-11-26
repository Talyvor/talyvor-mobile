import type { BffClient, PersonAccount } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { accountChip } from '../account'
import { roleName } from '../role-words'
import { useSession } from '../session'
import { outcome } from '../sound'
import { fonts, useTheme } from '../theme'
import { Icon } from './icon'
import { MoneyLabel, useMoneyLabels } from './money-label'
import { BottomSheet } from './pay-sheet'
import { Body, Button, Chip, Headline } from './ui'

// B61.10 — the sheet "Your accounts" on the phone, as the web's B61.9 (talyvor-suite apps/web/src/areas/lens/YourAccounts.tsx)
// and Pocket Live's sheet `accounts` draw it: each of the person's accounts with its avatar, name and chip, the current one
// marked, then "Open another account", which runs sign-up's steps for a person already signed in. Picking another row
// moves the session (the BFF's POST /api/accounts/switch, suite B61.8): the phone takes the new token, so every screen
// reads that account from then on, and Home opens with its words.
// B28.463 — an account a role was given in (suite B28.70) shows that role on its row as a chip, as the web's switcher does.

/** Where "Open another account" goes: sign-up's steps, for someone already signed in. */
export const OPEN_ANOTHER_HREF = '/sign-up?another=1'
export const NOTE = 'Each account has one kind of money. Another kind is another account.'
const SWITCH_FAILED = 'That account didn’t open. Try again.'
const READ_FAILED = 'Your accounts could not be read just now.'

/** Lens names a new workspace by its id (B55.39); a row never shows it. */
export const accountName = (a: { id: string; name: string }) => (!a.name || a.name === a.id ? 'Your workspace' : a.name)

function Row({ a, busy, onPick }: { a: PersonAccount; busy: boolean; onPick: () => void }) {
  const { c } = useTheme()
  const name = accountName(a)
  const chip = a.type && a.kind ? accountChip({ account_type: a.type, money_kind: a.kind }) : null
  const role = a.role ? roleName(a.role) : null
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={[name, chip, role, a.current ? 'Current' : null].filter(Boolean).join(', ')}
      accessibilityState={{ checked: a.current, disabled: busy }}
      disabled={busy}
      onPress={onPick}
      testID="account-row"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, borderWidth: 2, borderColor: a.current ? c.ink : c.cloud, backgroundColor: a.current ? c.page : c.cloud }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: c.page }}>{name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 16, color: c.ink }}>
          {name}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {chip ? <Chip>{chip}</Chip> : null}
          {role ? <Chip>{role}</Chip> : null}
        </View>
      </View>
      {a.current ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="check" size={16} color={c.ink} />
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>Current</Text>
        </View>
      ) : (
        <Icon name="chev" size={16} color={c.ink3} />
      )}
    </Pressable>
  )
}

/** Your accounts, over whichever screen opened it. */
export function YourAccountsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { client, switchAccount } = useSession()
  const { c } = useTheme()
  const labels = useMoneyLabels()
  // Kept with the session that read it: after a switch the list is read again, with the new account marked.
  const [read, setRead] = useState<{ client: BffClient; accounts: PersonAccount[] | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => {
    if (!visible) return
    let live = true
    client.accounts().then(
      (accounts) => live && setRead({ client, accounts }),
      () => live && setRead({ client, accounts: null }),
    )
    return () => {
      live = false
    }
  }, [client, visible])

  const accounts = read?.client === client ? read.accounts : undefined
  const close = () => {
    setSaid(null)
    onClose()
  }
  const pick = async (a: PersonAccount) => {
    if (a.current) return close()
    setBusy(true)
    setSaid(null)
    try {
      await switchAccount(a.id)
      outcome('moved')
      close()
      router.replace('/')
    } catch {
      setSaid(SWITCH_FAILED)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={visible} onClose={close} testID="your-accounts">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>Your accounts</Headline>
        <MoneyLabel capability={Object.keys(labels ?? {})} />
      </View>
      {accounts ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Your accounts" style={{ gap: 8 }}>
          {accounts.map((a) => (
            <Row key={a.id} a={a} busy={busy} onPick={() => void pick(a)} />
          ))}
        </View>
      ) : (
        <Body muted>{accounts === null ? READ_FAILED : 'Reading…'}</Body>
      )}
      {said ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="x" size={16} color={c.danger} />
          <Body style={{ color: c.danger }}>{said}</Body>
        </View>
      ) : null}
      <Button
        variant="secondary"
        label="Open another account"
        disabled={busy}
        hint="Switching…"
        onPress={() => {
          close()
          router.push(OPEN_ANOTHER_HREF)
        }}
      />
      <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: c.ink3 }}>{NOTE}</Text>
    </BottomSheet>
  )
}
