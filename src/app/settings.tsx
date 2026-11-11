import { router } from 'expo-router'
import { useCallback } from 'react'
import { Text, View } from 'react-native'

import { KIND_LABEL, KIND_LINE, TYPE_FIXED, TYPE_LABEL, accountChip, useAccount } from '@/account'
import { Icon } from '@/components/icon'
import { NoticeSettingsCard } from '@/components/notice-settings'
import { Back, Button, Card, Eyebrow, Headline, LoadState, Row, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B59.35 — Settings, from the button at the top right of Home (launch pack design, DECISIONS 3): whose account this is,
// when notices arrive, Activity and its exports, and signing out of this phone. Security keys, team and roles, and
// limits are authorisation and come in B59.39; closing the account and your data in B59.29.
// B57.132 — drawn in Pocket: its own Back and headline, the account's avatar as the switcher draws it, rows in cloud cards.
// B59.11 — the account's chip under its name ("Business · Hybrid"), and its kind of money and type in the web's words.

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

          <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
        </>
      ) : null}
    </Screen>
  )
}
