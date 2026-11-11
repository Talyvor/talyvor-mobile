import { router } from 'expo-router'
import { useCallback } from 'react'

import { NoticeSettingsCard } from '@/components/notice-settings'
import { Button, Card, Eyebrow, Headline, LoadState, Row, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

// B59.35 — Settings, from the button at the top right of Home (launch pack design, DECISIONS 3): whose account this is,
// when notices arrive, Activity and its exports, and signing out of this phone. Security keys, team and roles, and
// limits are authorisation and come in B59.39; closing the account and your data in B59.29.

export default function SettingsScreen() {
  const { client, signOut } = useSession()
  const load = useCallback(async () => {
    const [me, name, notices] = await Promise.all([client.me(), client.workspaceName(), client.notices()])
    return { id: me.workspace_id, name: name.name, settings: notices.settings }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Settings</Eyebrow>
      <Headline>{data?.name || 'Settings'}</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          <Eyebrow>Profile</Eyebrow>
          <Card>
            <Row first title={data.name || data.id} sub="Account" />
            <Row title={data.id} sub="Account ID" />
          </Card>

          <Eyebrow>Notifications</Eyebrow>
          <NoticeSettingsCard initial={data.settings} />

          <Eyebrow>Activity</Eyebrow>
          <Card>
            <Row first title="Activity" onPress={() => router.push('/activity')} />
          </Card>

          <Button label="Sign out" onPress={() => void signOut()} />
        </>
      ) : null}
    </Screen>
  )
}
