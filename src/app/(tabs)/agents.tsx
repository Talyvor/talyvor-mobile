import { Link, router } from 'expo-router'
import { useCallback } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useAccount } from '@/account'
import { AgentRow, HOME_MONEY } from '@/components/home'
import { Icon } from '@/components/icon'
import { MoneyLabel } from '@/components/money-label'
import { Body, Button, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

/** B61.54 — the Agents tab (launch pack design, choice 1): every agent with its picture, the name its owner gave it, what
 * it does, what it holds in its own currency and Paused when it is, each opening its page, and Pause every agent at the
 * top right. B61.37: "New agent" under the list opens the flow that makes one (agents/new). */
export default function AgentsScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const { shows } = useAccount(client)
  const load = useCallback(async () => {
    const [book, accounts, approvals] = await Promise.all([client.book(), client.moneyAccounts(), client.approvals()])
    return { book, accounts: accounts.accounts ?? [], pending: (approvals.approvals ?? []).filter((a) => a.status === 'pending') }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const agents = (data?.book.agents ?? []).filter((a) => !a.archived_at)
  const allPaused = !!data?.book.all_paused_at

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>Agents</Headline>
        <MoneyLabel capability={HOME_MONEY} />
      </View>
      {agents.length && !allPaused ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Link href="/pause-all" asChild>
            <Pressable accessibilityRole="link" accessibilityLabel="Pause every agent" style={{ minHeight: 48, justifyContent: 'center' }}>
              <View style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: c.control, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Icon name="pause" size={16} color={c.ink} />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>Pause every agent</Text>
              </View>
            </Pressable>
          </Link>
        </View>
      ) : null}
      <LoadState loading={loading && !data} error={error} />
      {data && shows ? (
        agents.length === 0 ? (
          <View style={{ gap: 4 }}>
            <Body>No agents yet</Body>
            <Body muted>Give an agent its own account, wallet and card.</Body>
          </View>
        ) : (
          <View>
            {agents.map((a, i) => (
              <AgentRow
                key={a.id}
                agent={a}
                accounts={data.accounts}
                shows={shows}
                waiting={data.pending.some((p) => p.agent_id === a.id)}
                first={i === 0}
                paused={!!a.paused_at || allPaused}
                chip
              />
            ))}
          </View>
        )
      ) : null}
      {data && shows ? <Button label="New agent" icon="plus" onPress={() => router.push('/agents/new')} /> : null}
    </Screen>
  )
}
