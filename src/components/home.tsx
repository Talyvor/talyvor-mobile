import { formatMinor, type Agent, type AgentApproval, type AgentBook, type CurrencyAccount, type PaymentRequest } from '@talyvor/bff-client'
import { Link } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { accountChip, type Account, type Shows } from '../account'
import { fonts, palettes, useTheme } from '../theme'
import { PendingApprovals } from './approval-card'
import { AgentCard, agentCardLabel } from './card'
import { Face } from './face'
import { Icon } from './icon'
import { Money } from './money'
import { AGENT_CREDIT, MoneyLabel, PAY_OUT } from './money-label'
import { OwnerCard } from './owner-card'
import { PreparedPaymentCard } from './prepared-payment-card'
import { StartEveryAgentButton, StartEveryAgentSheet, useSigns } from './start-every-agent'
import { Body, Button } from './ui'

// B57.66 — the phone's Home as the launch pack draws it (design P3 to P5): the account and the Sandbox label, the total
// in each currency the account's kind shows, Pay, the row that counts what waits for your yes with each request under
// it, the cards, and each agent Running or Paused with what it holds.

export interface HomeData {
  book: AgentBook
  approvals: AgentApproval[]
  prepared: PaymentRequest[]
  accounts: CurrencyAccount[]
}

/** What Home's figures move money on: the agents' balances and the payments that wait. */
const HOME_MONEY = [...AGENT_CREDIT, ...PAY_OUT]

/** A currency's name on its tile, as P3 and P4 draw them; a stablecoin is named by its code. */
const CURRENCY_NAME: Record<string, string> = { USD: 'US dollar', EUR: 'Euro', GBP: 'British pound' }
const FIAT_ORDER = ['USD', 'EUR', 'GBP']
const isStablecoin = (currency: string) => !(currency in CURRENCY_NAME)

/** What each currency holds across the accounts in view, the company's and each agent's, fiat first; a currency the
 * account's kind does not show is left out. */
export function balancesByCurrency(accounts: readonly CurrencyAccount[], shows: Pick<Shows, 'bankTransfers' | 'onChain'>): { currency: string; minor: number }[] {
  const sums = new Map<string, number>()
  for (const a of accounts) {
    if (isStablecoin(a.currency) ? !shows.onChain : !shows.bankTransfers) continue
    sums.set(a.currency, (sums.get(a.currency) ?? 0) + a.balance_minor)
  }
  const rank = (c: string) => (isStablecoin(c) ? 10 : FIAT_ORDER.indexOf(c))
  return [...sums].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency))
}

/** "2 payments wait for your yes", or "1 payment waits for your yes". */
export const waitingWords = (n: number) => (n === 1 ? '1 payment waits for your yes' : `${n} payments wait for your yes`)

function SectionHead({ title, more }: { title: string; more?: { href: '/cards'; label: string } }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 21.5, color: c.ink }}>
        {title}
      </Text>
      {more ? (
        <Link href={more.href} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={more.label} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink, textDecorationLine: 'underline' }}>See all</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  )
}

/** The account pill: its initial, its name, and "Business · Hybrid". */
function AccountPill({ name, account }: { name: string | null; account: Account | null }) {
  const { c } = useTheme()
  if (!name && !account) return <View />
  const chip = account ? accountChip(account) : null
  return (
    <View
      accessible
      accessibilityLabel={[name, chip].filter(Boolean).join(', ')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingLeft: 6, paddingRight: 16, borderRadius: 999, backgroundColor: c.cloud, flexShrink: 1 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.page, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{(name ?? chip ?? '').trim().charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flexShrink: 1 }}>
        {name ? (
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>
            {name}
          </Text>
        ) : null}
        {chip ? <Text style={{ fontFamily: fonts.uiMedium, fontSize: 12, color: c.ink2 }}>{chip}</Text> : null}
      </View>
    </View>
  )
}

/** Home's top: the account, Sandbox or Live, and Settings. Drawn while Home reads and when it fails, too. */
export function HomeHeader({ name, account }: { name: string | null; account: Account | null }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <AccountPill name={name} account={account} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ justifyContent: 'center' }}>
          <MoneyLabel capability={HOME_MONEY} />
        </View>
        {/* B59.35 — Settings opens from the top right of Home (launch pack design, DECISIONS 3). */}
        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="settings" color={c.ink} />
          </Pressable>
        </Link>
      </View>
    </View>
  )
}

/** The total: one currency is the figure itself; several are a tile each, since no rate is read to add them up. */
function Total({ business, shows, accounts }: { business: boolean; shows: Shows; accounts: readonly CurrencyAccount[] }) {
  const { c } = useTheme()
  const held = balancesByCurrency(accounts, shows)
  const label = { fontFamily: fonts.uiMedium, fontSize: 12, letterSpacing: 0.48, textTransform: 'uppercase', color: c.ink3 } as const
  return (
    <View style={{ gap: 8 }}>
      <Text style={label}>{business ? 'Your company’s total' : 'Your total'}</Text>
      {held.length === 0 ? (
        <>
          <Money minor={0} currency="USD" size={44} />
          <Body muted>{shows.bankTransfers ? 'Top up to get started.' : 'Receive stablecoins to get started.'}</Body>
        </>
      ) : held.length === 1 ? (
        <Money minor={held[0].minor} currency={held[0].currency} size={44} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, borderRadius: 24, padding: 16, backgroundColor: c.cloud }}>
          {held.map(({ currency, minor }) => {
            const name = CURRENCY_NAME[currency] ?? currency
            const amount = formatMinor(minor, currency).replace(` ${currency}`, '')
            return (
              <View key={currency} accessible accessibilityLabel={`${name}, ${amount}`} style={{ width: '33.33%', gap: 2 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: c.ink3 }}>{name}</Text>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{amount}</Text>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

/** Quick actions: only the ones the phone has a screen for. */
function Actions() {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
      <Link href="/pay" asChild>
        <Pressable accessibilityRole="link" accessibilityLabel="Pay" style={{ alignItems: 'center', gap: 6, minWidth: 72 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.cloud, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="payments" color={c.ink} />
          </View>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: c.ink }}>Pay</Text>
        </Pressable>
      </Link>
    </View>
  )
}

function WaitingRow({ count }: { count: number }) {
  const { c } = useTheme()
  const words = waitingWords(count)
  return (
    <Link href="/approvals" asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={words}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.tangerine50 }}>
        <View style={{ minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: c.tangerine, alignItems: 'center', justifyContent: 'center' }}>
          {/* Ink on tangerine in both themes, as the tab bar's badge. */}
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: palettes.light.ink }}>{count}</Text>
        </View>
        <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{words}</Text>
        <Icon name="chev" color={c.ink} />
      </Pressable>
    </Link>
  )
}

function AgentRow({ agent, accounts, shows, peg, waiting, first }: { agent: Agent; accounts: readonly CurrencyAccount[]; shows: Shows; peg: number | null; waiting: boolean; first: boolean }) {
  const { c } = useTheme()
  const held = balancesByCurrency(
    accounts.filter((x) => x.agent_id === agent.id),
    shows,
  )
  const fiat = held.filter((h) => !isStablecoin(h.currency))
  const coins = held.filter((h) => isStablecoin(h.currency))
  const state = agent.paused_at ? 'Paused' : 'Running'
  return (
    <Link href={{ pathname: '/agents/[id]', params: { id: agent.id } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${agent.name}, ${state.toLowerCase()}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
        <Face agent={agent} state={agent.paused_at ? 'asleep' : 'happy'} waiting={waiting} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.uiMedium, fontSize: 15, color: c.ink }}>{agent.name}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>
            {agent.description ? `${agent.description} · ${state}` : state}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {held.length === 0 ? (
            <Money micros={agent.balance_ulxc} peg={peg} size={15} balance />
          ) : (
            <>
              {fiat.length ? (
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{fiat.map((h) => formatMinor(h.minor, h.currency)).join(' + ')}</Text>
              ) : null}
              {coins.map((h) => (
                <Text key={h.currency} style={{ fontFamily: fiat.length ? fonts.ui : fonts.uiBold, fontSize: fiat.length ? 12.5 : 15, color: fiat.length ? c.ink3 : c.ink, fontVariant: ['tabular-nums'] }}>
                  {formatMinor(h.minor, h.currency)}
                </Text>
              ))}
            </>
          )}
        </View>
      </Pressable>
    </Link>
  )
}

export function HomeView({
  data,
  account,
  shows,
  name,
  peg,
  onDecided,
}: {
  data: HomeData
  account: Account | null
  shows: Shows
  name: string | null
  peg: number | null
  onDecided: () => void
}) {
  const { c } = useTheme()
  const agents = (data.book.agents ?? []).filter((a) => !a.archived_at)
  const pending = data.approvals.filter((a) => a.status === 'pending')
  const waiting = pending.length + data.prepared.length
  const allPaused = !!data.book.all_paused_at
  const signs = useSigns()
  const [starting, setStarting] = useState(false)
  return (
    <>
      <Total business={shows.team} shows={shows} accounts={data.accounts} />
      <Actions />
      {/* B57.71 — Pocket's .killp: every agent is paused, and the way to start them again, signed. */}
      {allPaused ? (
        <View style={{ gap: 4, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.danger50 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, lineHeight: 21, color: c.ink }}>Every agent is paused.</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: c.ink2, marginBottom: 8 }}>Nothing they ask for is paid until you start them again.</Text>
          <StartEveryAgentButton small signs={signs} onPress={() => setStarting(true)} />
        </View>
      ) : null}
      <StartEveryAgentSheet
        visible={starting}
        signs={signs}
        onClose={() => setStarting(false)}
        onStarted={() => {
          setStarting(false)
          onDecided()
        }}
      />
      {waiting ? <WaitingRow count={waiting} /> : null}
      {data.prepared.map((r) => (
        <PreparedPaymentCard key={r.id} request={r} />
      ))}
      <PendingApprovals pending={pending} agents={data.book.agents ?? []} allPaused={allPaused} onDecided={onDecided} />
      <Link href="/activity" asChild>
        <Pressable accessibilityRole="link" style={{ minHeight: 48, justifyContent: 'center' }}>
          <Body style={{ color: c.tangerineInk }}>See all in Activity</Body>
        </Pressable>
      </Link>

      {/* B57.126 and B57.128: the owner's own card, then each agent's, each opening its screen. */}
      {agents.length || (account && name) ? (
        <>
          <SectionHead title="Cards" more={{ href: '/cards', label: 'See all cards' }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingBottom: 18 }}>
            {account && name ? (
              <Link href="/cards" asChild>
                <Pressable accessibilityRole="link" accessibilityLabel={`${name}'s card`}>
                  <OwnerCard account={account} holder={name} width={152} />
                </Pressable>
              </Link>
            ) : null}
            {agents.map((a) => (
              <Link key={a.id} href={{ pathname: '/agents/[id]', params: { id: a.id } }} asChild>
                <Pressable accessibilityRole="link" accessibilityLabel={agentCardLabel(a.name, a.description ?? '')}>
                  <AgentCard agent={a} width={152} />
                </Pressable>
              </Link>
            ))}
          </ScrollView>
        </>
      ) : null}

      {/* B59.11 — "Your agents", or a Business's "Your team’s agents", as the web's Home says. */}
      <SectionHead title={shows.agents} />
      {agents.length === 0 ? (
        <View style={{ gap: 4 }}>
          <Body>No agents yet</Body>
          <Body muted>Give an agent its own account, wallet and card.</Body>
        </View>
      ) : (
        <View>
          {agents.map((a, i) => (
            <AgentRow key={a.id} agent={a} accounts={data.accounts} shows={shows} peg={peg} waiting={pending.some((p) => p.agent_id === a.id)} first={i === 0} />
          ))}
        </View>
      )}
      {agents.length && !allPaused ? (
        <Link href="/pause-all" asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Pause every agent"
            style={{ minHeight: 48, borderRadius: 999, borderWidth: 1.5, borderColor: c.control, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="pause" color={c.ink} />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: c.ink }}>Pause every agent</Text>
          </Pressable>
        </Link>
      ) : null}
    </>
  )
}

/** Home while it reads: grey blocks in the shape of the total, the balances and three rows; never a figure. */
export function HomeLoading() {
  const { c } = useTheme()
  const block = (height: number, width: number | `${number}%` = '100%', radius = 14) => ({ height, width, borderRadius: radius, backgroundColor: c.cloud2 })
  return (
    <View accessible accessibilityLabel="Reading…" testID="home-loading" style={{ gap: 14 }}>
      <View style={block(48, 200, 999)} />
      <View style={block(44, 220)} />
      <View style={block(72, '100%', 24)} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={block(58)} />
      ))}
    </View>
  )
}

/** Home's failed read: what failed, that nothing changed, and one button. */
export function HomeError({ onRetry }: { onRetry: () => void }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Icon name="x" color={c.danger} />
        <Body style={{ color: c.danger, flex: 1 }}>We couldn’t read your balances. Nothing changed.</Body>
      </View>
      <Button primary label="Try again" onPress={onRetry} />
    </View>
  )
}
