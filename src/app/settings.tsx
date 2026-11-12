import { router } from 'expo-router'
import { useCallback } from 'react'
import { Text, View } from 'react-native'

import { KIND_LABEL, KIND_LINE, TYPE_FIXED, TYPE_LABEL, accountChip, useAccount } from '@/account'
import { COMPANY_ROW } from '@/company-words'
import { Icon, type IconName } from '@/components/icon'
import { NoticeSettingsCard } from '@/components/notice-settings'
import { Back, Button, Card, Eyebrow, Headline, LoadState, Row, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B59.35 — Settings, from the button at the top right of Home (launch pack design, DECISIONS 3): whose account this is,
// when notices arrive, Activity and its exports, and signing out of this phone. Security keys, team and roles, and
// limits are authorisation and come in B59.39.
// B57.132 — drawn in Pocket: its own Back and headline, the account's avatar as the switcher draws it, rows in cloud cards.
// B59.11 — the account's chip under its name ("Business · Hybrid"), and its kind of money and type in the web's words.
// B59.29 — Help and complaints, Your data and Close this account, as the web's Settings lists them (suite B59.28).
// B59.32 — a Business's Company details, under its profile (suite B59.31).

const HELP_ROWS: readonly { to: '/settings/help' | '/settings/data' | '/settings/close'; icon: IconName; title: string; line: string }[] = [
  { to: '/settings/help', icon: 'send', title: 'Help and complaints', line: 'Ask us something, or make a complaint' },
  { to: '/settings/data', icon: 'download', title: 'Your data', line: 'A copy of your data, or ask for it to be deleted' },
  { to: '/settings/close', icon: 'lock', title: 'Close this account', line: 'What must be empty first, and asking to close' },
]

export default function SettingsScreen() {
  const { client, signOut } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [me, name, notices] = await Promise.all([client.me(), client.workspaceName(), client.notices()])
    return { id: me.workspace_id, name: name.name, settings: notices.settings }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const { account } = useAccount(client)
  const tile = { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.cloud2 }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/" />
      <Headline>Settings</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          <Eyebrow>Profile</Eyebrow>
          <Card>
            <Row
              first
              left={
                <View style={tile}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{(data.name || data.id).slice(0, 1).toUpperCase()}</Text>
                </View>
              }
              title={data.name || data.id}
              sub={account ? accountChip(account) : 'Account'}
            />
            <Row title={data.id} sub="Account ID" />
            {account?.account_type === 'business' ? (
              <Row
                left={
                  <View style={tile}>
                    <Icon name="shield" size={18} color={c.ink} />
                  </View>
                }
                title={COMPANY_ROW.title}
                sub={COMPANY_ROW.line}
                right={<Icon name="chev" size={16} color={c.ink3} />}
                onPress={() => router.push('/settings/company')}
              />
            ) : null}
          </Card>

          {account ? (
            <>
              <Eyebrow>Kind of money</Eyebrow>
              <Card>
                <Row first title={KIND_LABEL[account.money_kind]} sub={KIND_LINE[account.money_kind]} />
              </Card>
              <Eyebrow>Account type</Eyebrow>
              <Card>
                <Row first title={TYPE_LABEL[account.account_type]} sub={TYPE_FIXED} />
              </Card>
            </>
          ) : null}

          <Eyebrow>Notifications</Eyebrow>
          <NoticeSettingsCard initial={data.settings} />

          <Eyebrow>Activity</Eyebrow>
          <Card>
            <Row
              first
              left={
                <View style={tile}>
                  <Icon name="statements" size={18} color={c.ink} />
                </View>
              }
              title="Activity"
              right={<Icon name="chev" size={16} color={c.ink3} />}
              onPress={() => router.push('/activity')}
            />
          </Card>

          <Eyebrow>Help and your account</Eyebrow>
          <Card>
            {HELP_ROWS.map((r, i) => (
              <Row
                key={r.to}
                first={i === 0}
                left={
                  <View style={tile}>
                    <Icon name={r.icon} size={18} color={c.ink} />
                  </View>
                }
                title={r.title}
                sub={r.line}
                right={<Icon name="chev" size={16} color={c.ink3} />}
                onPress={() => router.push(r.to)}
              />
            ))}
          </Card>

          <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
        </>
      ) : null}
    </Screen>
  )
}
