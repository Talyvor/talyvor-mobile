import { formatMinor, type Agent, type AgentApproval, type AgentBook, type CurrencyAccount, type PaymentRequest } from '@talyvor/bff-client'
import { Link } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { accountChip, type Account, type Shows } from '../account'
import { balancesByCurrency, CURRENCY_NAME, isStablecoin } from '../balances'
import { fonts, palettes, useTheme } from '../theme'
import { PendingApprovals } from './approval-card'
import { Breathe, Rise, RoundRing, useRipple } from './effects'
import { AgentCard, agentCardLabel } from './card'
import { Face } from './face'
import { FlightSource, useTakeOff } from './picture-flight'
import { Icon } from './icon'
import { Shapes } from './live'
import { Money, useRolled } from './money'
import { AGENT_CREDIT, MoneyLabel, PAY_OUT } from './money-label'
import { OwnerCard } from './owner-card'
import { PreparedPaymentCard } from './prepared-payment-card'
import { Press } from './press'
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
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingLeft: 6, paddingRight: 12, borderRadius: 999, backgroundColor: c.cloud, boxShadow: `inset 0 0 0 1px ${c.frostLine}`, flexShrink: 1 }}>
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
  // On the background, so ink-2 (B61.99).
  const label = { fontFamily: fonts.uiMedium, fontSize: 12, letterSpacing: 0.48, textTransform: 'uppercase', color: c.ink2 } as const
  return (
    <View style={{ gap: 8 }}>
      <Text style={label}>{business ? 'Your company’s total' : 'Your total'}</Text>
      {held.length === 0 ? (
        <>
          <Money minor={0} currency="USD" size={44} />
          <Body muted>{shows.bankTransfers ? 'Add money to get started.' : 'Receive stablecoins to get started.'}</Body>
        </>
      ) : held.length === 1 ? (
        <Money minor={held[0].minor} currency={held[0].currency} size={44} countUp />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, borderRadius: 24, padding: 16, backgroundColor: c.cloud }}>
          {held.map(({ currency, minor }) => (
            <Tile key={currency} currency={currency} minor={minor} />
          ))}
        </View>
      )}
    </View>
  )
}

/** One currency's tile in the total: its name and what it holds, counting up as the app opens. */
function Tile({ currency, minor }: { currency: string; minor: number }) {
  const { c } = useTheme()
  const name = CURRENCY_NAME[currency] ?? currency
  const words = (v: number) => formatMinor(v, currency).replace(` ${currency}`, '')
  const drawn = useRolled(minor, currency, true)
  return (
    <View accessible accessibilityLabel={`${name}, ${words(minor)}`} style={{ width: '33.33%', gap: 2 }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: c.ink3 }}>{name}</Text>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{words(drawn)}</Text>
    </View>
  )
}

/** A round quick action: it ripples in a tint of ink under the finger and a ring opens around it as the finger lifts
 * (B61.130). */
function QuickAction({ href, label, words, icon }: { href: '/pay' | '/instant-transfer'; label: string; words: string; icon: 'payments' | 'send' }) {
  const { c } = useTheme()
  const [lifted, setLifted] = useState(0)
  const ripple = useRipple('ink', 24)
  const outer = useRef(72)
  return (
    <Link href={href} asChild>
      <Press
        kind="round"
        accessibilityRole="link"
        accessibilityLabel={label}
        onLayout={(e) => (outer.current = e.nativeEvent.layout.width)}
        // The finger's point, from the action's box to its circle's, which sits centred at the top.
        onPressIn={(e) => ripple.start({ ...e, nativeEvent: { ...e.nativeEvent, locationX: e.nativeEvent.locationX - (outer.current - 48) / 2 } })}
        onPressOut={() => setLifted((n) => n + 1)}
        style={{ alignItems: 'center', gap: 6, minWidth: 72 }}>
        <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <RoundRing n={lifted} size={48} />
          <View onLayout={ripple.onLayout} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.cloud, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} color={c.ink} />
            {ripple.layer}
          </View>
        </View>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: c.ink }}>{words}</Text>
      </Press>
    </Link>
  )
}

/** Quick actions: only the ones the phone has a screen for. */
function Actions({ instant }: { instant: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
      <QuickAction href="/pay" label="Pay" words="Pay" icon="payments" />
      {/* B59.20 — Instant transfer, for a Hybrid account; B61.80: "Instant" under the round action, the full name read aloud. */}
      {instant ? <QuickAction href="/instant-transfer" label="Instant transfer" words="Instant" icon="send" /> : null}
    </View>
  )
}

function WaitingRow({ count }: { count: number }) {
  const { c } = useTheme()
  const words = waitingWords(count)
  return (
    <View>
      {/* B61.130 — a soft tangerine halo breathes in and out around what waits for your yes. */}
      <Breathe radius={16} />
      <Link href="/approvals" asChild>
      <Press
        kind="row"
        haptic={false}
        ripple="tangerine"
        radius={16}
        accessibilityRole="link"
        accessibilityLabel={words}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.tangerine50 }}>
        <View style={{ minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: c.tangerine, alignItems: 'center', justifyContent: 'center' }}>
          {/* Ink on tangerine in both themes, as the tab bar's badge. */}
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: palettes.light.ink }}>{count}</Text>
        </View>
        <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{words}</Text>
        <Icon name="chev" color={c.ink} />
      </Press>
      </Link>
    </View>
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
  const { ref, takeOff, flying } = useTakeOff(agent, asleep ? 'asleep' : 'happy')
  return (
    <Link href={{ pathname: '/agents/[id]', params: { id: agent.id } }} asChild>
      <Pressable
        accessibilityRole="link"
        onPress={takeOff}
        accessibilityLabel={`${agent.name}, ${state.toLowerCase()}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
        <FlightSource face={ref} flying={flying}>
          <Face agent={agent} state={asleep ? 'asleep' : 'happy'} waiting={waiting} size={40} />
        </FlightSource>
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
      {/* B61.130 — as the app opens, Home's blocks rise in one after another. */}
      <Rise index={0}>
      <Total business={shows.team} shows={shows} accounts={data.accounts} />
      {/* B59.33 — what each account holds, side by side by the kind of money. */}
      <Link href="/wallets" asChild>
        <Pressable accessibilityRole="link" style={{ minHeight: 48, justifyContent: 'center' }}>
          <Body style={{ color: c.tangerineInk }}>See all in Wallets</Body>
        </Pressable>
      </Link>
      </Rise>
      <Rise index={1}>
      <Actions instant={shows.instantTransfer} />
      </Rise>
      <Rise index={2}>
      {/* B57.71 — Pocket's .killp: every agent is paused, and the way to start them again, signed. */}
      {allPaused ? (
        <View style={{ gap: 4, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.danger50 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, lineHeight: 21, color: c.ink }}>Every agent is paused.</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: c.ink2, marginBottom: 8 }}>Nothing they ask for is paid until you start them again.</Text>
          <StartEveryAgentButton small signs={signs} onPress={() => setStarting(true)} />
        </View>
      ) : null}
      </Rise>
      <StartEveryAgentSheet
        visible={starting}
        signs={signs}
        onClose={() => setStarting(false)}
        onStarted={() => {
          setStarting(false)
          onDecided()
        }}
      />
      <Rise index={3}>
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
      </Rise>
      <Rise index={4}>

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

      </Rise>
      <Rise index={5}>
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
      </Rise>
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
  return <Shapes figure rows={3} testID="home-loading" />
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
