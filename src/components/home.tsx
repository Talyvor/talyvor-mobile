import { formatMinor, type Agent, type AgentApproval, type AgentBook, type CurrencyAccount, type PaymentRequest } from '@talyvor/bff-client'
import { Link } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { accountChip, type Account, type Shows } from '../account'
import { balancesByCurrency, CURRENCY_NAME, isStablecoin } from '../balances'
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
import { Body, Button, Chip } from './ui'
import { YourAccountsSheet } from './your-accounts'

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
export const HOME_MONEY = [...AGENT_CREDIT, ...PAY_OUT]

export { balancesByCurrency, CURRENCY_NAME, isStablecoin } from '../balances'

/** "2 payments wait for your yes", or "1 payment waits for your yes". */
export const waitingWords = (n: number) => (n === 1 ? '1 payment waits for your yes' : `${n} payments wait for your yes`)

function SectionHead({ title, more }: { title: string; more?: { href: '/cards' | '/agents'; label: string } }) {
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

/** The account pill: its initial, its name, and "Business · Hybrid". B61.10 — pressing it opens Your accounts. */
function AccountPill({ name, account }: { name: string | null; account: Account | null }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  if (!name && !account) return <View />
  const chip = account ? accountChip(account) : null
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Switch account. ${[name, chip].filter(Boolean).join(', ')}`}
        onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingLeft: 6, paddingRight: 12, borderRadius: 999, backgroundColor: c.cloud, flexShrink: 1 }}>
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
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Icon name="chev" size={16} color={c.ink2} />
        </View>
      </Pressable>
      <YourAccountsSheet visible={open} onClose={() => setOpen(false)} />
    </>
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
function Actions({ instant }: { instant: boolean }) {
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
      {/* B59.20 — Instant transfer, for a Hybrid account. */}
      {instant ? (
        <Link href="/instant-transfer" asChild>
          <Pressable accessibilityRole="link" accessibilityLabel="Instant transfer" style={{ alignItems: 'center', gap: 6, minWidth: 72 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.cloud, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="send" color={c.ink} />
            </View>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: c.ink }}>Instant transfer</Text>
          </Pressable>
        </Link>
      ) : null}
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

/** An agent's row: its picture, its name, what it does, and what it holds in its own currency. Home writes Running or
 * Paused after what it does; the Agents tab (B61.54) puts a Paused chip on a paused one instead. */
export function AgentRow({ agent, accounts, shows, waiting, first, paused, chip }: { agent: Agent; accounts: readonly CurrencyAccount[]; shows: Shows; waiting: boolean; first: boolean; paused?: boolean; chip?: boolean }) {
  const { c } = useTheme()
  const held = balancesByCurrency(
    accounts.filter((x) => x.agent_id === agent.id),
    shows,
  )
  const fiat = held.filter((h) => !isStablecoin(h.currency))
  const coins = held.filter((h) => isStablecoin(h.currency))
  const asleep = paused ?? !!agent.paused_at
  const state = asleep ? 'Paused' : 'Running'
  return (
    <Link href={{ pathname: '/agents/[id]', params: { id: agent.id } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${agent.name}, ${state.toLowerCase()}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
        <Face agent={agent} state={asleep ? 'asleep' : 'happy'} waiting={waiting} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: chip ? 4 : 0 }}>
          <Text style={{ fontFamily: fonts.uiMedium, fontSize: 15, color: c.ink }}>{agent.name}</Text>
          {chip ? (
            <>
              {agent.description ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{agent.description}</Text> : null}
              {asleep ? (
                <View style={{ alignSelf: 'flex-start' }}>
                  <Chip tone="paused">Paused</Chip>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>{agent.description ? `${agent.description} · ${state}` : state}</Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {/* B61.15: an agent's money is its currency accounts; its credit is the parked gateway's and is not drawn. */}
          {held.length === 0 ? null : (
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
  onDecided,
}: {
  data: HomeData
  account: Account | null
  shows: Shows
  name: string | null
  /** unread since B61.15: Home draws no figure at the peg */
  peg?: number | null
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
      {/* B59.33 — what each account holds, side by side by the kind of money. */}
      <Link href="/wallets" asChild>
        <Pressable accessibilityRole="link" style={{ minHeight: 48, justifyContent: 'center' }}>
          <Body style={{ color: c.tangerineInk }}>See all in Wallets</Body>
        </Pressable>
      </Link>
      <Actions instant={shows.instantTransfer} />
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
      {/* B61.54 — Spending and Statement left the tab bar and open from here and from Activity. */}
      <MoneyLinks />

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
      {/* B61.54 — See all opens the Agents tab, as P5 draws it. */}
      <SectionHead title={shows.agents} more={agents.length ? { href: '/agents', label: 'See all agents' } : undefined} />
      {agents.length === 0 ? (
        <View style={{ gap: 4 }}>
          <Body>No agents yet</Body>
          <Body muted>Give an agent its own account, wallet and card.</Body>
        </View>
      ) : (
        <View>
          {agents.map((a, i) => (
            <AgentRow key={a.id} agent={a} accounts={data.accounts} shows={shows} waiting={pending.some((p) => p.agent_id === a.id)} first={i === 0} />
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

/** Spending and Statement, which open from Home and from Activity (B61.54). */
export function MoneyLinks() {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 20 }}>
      {(['Spending', 'Statement'] as const).map((words) => (
        <Link key={words} href={words === 'Spending' ? '/spending' : '/statement'} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={words} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Body style={{ color: c.tangerineInk }}>{words}</Body>
          </Pressable>
        </Link>
      ))}
    </View>
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
