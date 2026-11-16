import { formatMinor, type Agent, type AgentRules, type CurrencyAccount, type Spending } from '@talyvor/bff-client'
import { Link, router } from 'expo-router'
import { useCallback } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useAccount, type Shows } from '@/account'
import { balancesByCurrency, isStablecoin } from '@/balances'
import { HOME_MONEY } from '@/components/home'
import { Face } from '@/components/face'
import { Icon, type IconName } from '@/components/icon'
import { MoneyLabel } from '@/components/money-label'
import { Bar, Body, Button, Card, Chip, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { spendPeriod } from '@/spending'
import { fonts, useTheme } from '@/theme'

/** B61.54 — the Agents tab (launch pack design, choice 1): every agent with its picture, the name its owner gave it, what
 * it does, what it holds in its own currency and Paused when it is, each opening its page, and Pause every agent at the
 * top right. B61.37: "New agent" under the list opens the flow that makes one (agents/new).
 * B57.176 — as Pocket Live's phone view `agents` draws it: the line under the headline, each agent a card with Running
 * or Paused beside its balance and what it spent this month of its monthly limit, in its rules' currency (B61.88), and
 * Pause every agent (Resume every agent once all are paused) and New agent as round buttons at the top right. */
export default function AgentsScreen() {
  const { client } = useSession()
  const { shows } = useAccount(client)
  const load = useCallback(async () => {
    const month = spendPeriod('month')
    const [book, accounts, approvals, spending] = await Promise.all([
      client.book(),
      client.moneyAccounts(),
      client.approvals(),
      // The month's line is drawn only from what is read; a failed read leaves it out, never the list.
      client.spending(month.from, month.to).catch(() => null),
    ])
    const live = (book.agents ?? []).filter((a) => !a.archived_at)
    const rules = await Promise.all(live.map((a) => client.rules(a.id).catch(() => null)))
    return {
      book,
      agents: live,
      rules: Object.fromEntries(live.map((a, i) => [a.id, rules[i]])) as Record<string, AgentRules | null>,
      spending,
      accounts: accounts.accounts ?? [],
      pending: (approvals.approvals ?? []).filter((a) => a.status === 'pending'),
    }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const agents = data?.agents ?? []
  const allPaused = !!data?.book.all_paused_at

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flexShrink: 1 }}>
          <Headline>Agents</Headline>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <MoneyLabel capability={HOME_MONEY} />
          {agents.length ? <TopButton href="/pause-all" icon={allPaused ? 'arrow' : 'pause'} label={allPaused ? 'Resume every agent' : 'Pause every agent'} /> : null}
          {data && shows ? <TopButton href="/agents/new" icon="plus" label="New agent" /> : null}
        </View>
      </View>
      <Body muted>Each agent has its own account, card and rules. You name it and set its limits.</Body>
      <LoadState loading={loading && !data} error={error} />
      {data && shows ? (
        agents.length === 0 ? (
          <View style={{ gap: 4 }}>
            <Body>No agents yet</Body>
            <Body muted>Give an agent its own account, wallet and card.</Body>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                accounts={data.accounts}
                shows={shows}
                rules={data.rules[a.id]}
                spending={data.spending}
                waiting={data.pending.some((p) => p.agent_id === a.id)}
                paused={!!a.paused_at || allPaused}
              />
            ))}
          </View>
        )
      ) : null}
      {data && shows ? <Button variant="secondary" label="New agent" icon="plus" onPress={() => router.push('/agents/new')} /> : null}
    </Screen>
  )
}

function TopButton({ href, icon, label }: { href: '/pause-all' | '/agents/new'; icon: IconName; label: string }) {
  const { c } = useTheme()
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud }}>
          <Icon name={icon} size={20} color={c.ink} />
        </View>
      </Pressable>
    </Link>
  )
}

/** What the agent spent this month of its monthly limit, both in its rules' currency; nothing without a limit. */
function monthOf(agent: Agent, rules: AgentRules | null, spending: Spending | null) {
  const currency = rules?.currency
  const limit = rules?.monthly_limit_minor ?? 0
  if (!currency || limit <= 0 || !spending) return null
  const spent = (spending.totals ?? []).filter((t) => t.agent_id === agent.id && t.currency === currency).reduce((n, t) => n + t.total_minor, 0)
  return { spent, limit, words: `${formatMinor(spent, currency)} of ${formatMinor(limit, currency)} this month` }
}

function AgentCard({
  agent,
  accounts,
  shows,
  rules,
  spending,
  waiting,
  paused,
}: {
  agent: Agent
  accounts: readonly CurrencyAccount[]
  shows: Shows
  rules: AgentRules | null
  spending: Spending | null
  waiting: boolean
  paused: boolean
}) {
  const { c } = useTheme()
  const held = balancesByCurrency(
    accounts.filter((x) => x.agent_id === agent.id),
    shows,
  )
  const fiat = held.filter((h) => !isStablecoin(h.currency))
  const coins = held.filter((h) => isStablecoin(h.currency))
  const month = monthOf(agent, rules, spending)
  return (
    <Link href={{ pathname: '/agents/[id]', params: { id: agent.id } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${agent.name}, ${paused ? 'paused' : 'running'}`}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Face agent={agent} state={paused ? 'asleep' : 'happy'} waiting={waiting} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: c.ink }}>{agent.name}</Text>
              {agent.description ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{agent.description}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {fiat.length ? (
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{fiat.map((h) => formatMinor(h.minor, h.currency)).join(' + ')}</Text>
              ) : null}
              {coins.map((h) => (
                <Text key={h.currency} style={{ fontFamily: fiat.length ? fonts.ui : fonts.uiBold, fontSize: fiat.length ? 12.5 : 15, color: fiat.length ? c.ink3 : c.ink, fontVariant: ['tabular-nums'] }}>
                  {formatMinor(h.minor, h.currency)}
                </Text>
              ))}
              {paused ? (
                <Chip tone="paused">Paused</Chip>
              ) : (
                <Chip tone="good" dot>
                  Running
                </Chip>
              )}
            </View>
          </View>
          {month ? (
            <>
              <Bar thin value={month.spent / month.limit} label={`${agent.name}: ${month.words}`} />
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3, fontVariant: ['tabular-nums'] }}>{month.words}</Text>
            </>
          ) : null}
        </Card>
      </Pressable>
    </Link>
  )
}
