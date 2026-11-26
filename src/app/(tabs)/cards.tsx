import { BffError, formatMinor, refusalText, type Agent, type AgentCard as Held, type AgentRules, type CardAuthorization, type CardSpend } from '@talyvor/bff-client'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { AppState, useWindowDimensions, View } from 'react-native'

import { useAccount } from '@/account'
import { AgentCard } from '@/components/card'
import { DisputesAndRefunds } from '@/components/card-disputes'
import { CardSpends } from '@/components/card-spends'
import { CardLimits, IssueCard } from '@/components/card-forms'
import { Icon } from '@/components/icon'
import { OwnerCard } from '@/components/owner-card'
import { BottomSheet } from '@/components/pay-sheet'
import { Body, Button, Card, Chip, Eyebrow, Figure, Headline, LoadState, Row, Screen, Toggle, useLoad } from '@/components/ui'
import { DISPUTE_WORDS } from '@/dispute-words'
import { biometricName, checkItsYou, keyGoneText } from '@/keys'
import { useSession } from '@/session'
import { outcome, play } from '@/sound'

// B59.34 — Cards: each agent's card in its approved art (B57.126), frozen or not, the limits its purchases are judged by,
// and every purchase with what its rules decided, in the web's words (AgentCardPanel.tsx, CardFreeze.tsx). The card's
// details stay hidden until Face ID or a fingerprint, and hide again when you leave the tab. Freeze and Unfreeze are
// Lens's own: a frozen card is refused every purchase and nothing leaves the agent's wallet.
// B59.26 — each agent's disputes and refunds under its card, and Disputes and refunds opens the card payments to dispute
// and Export (the web's B59.25).
// B57.136 — in Pocket: each card sits in Pocket's panel with the agent's name and Frozen, and Freeze card is a switch, as
// the reference's agent page draws its card; the limits are a list in their own panel, like the agent screen's Rules.
// B59.44 — the owner's or company's own card above the agents', in its account's tier art (B57.128); Change limits, saved
// as the web's Save rules is and signed with the phone's key when it loosens them; and Issue a card for an agent with none.
// B57.160 — in Pocket: the owner's card at the top, in its tier art, bare and full width as P3's Cards strip draws it,
// above Disputes and refunds; Change limits and Issue a card as the reference's rules draw a list of settings.
// B57.227 — in Pocket: Replace card as the agent page draws Pause (.btn.secondary), Cancel card as .btn.danger, and the
// sheet that asks as Pocket Live's close-account sheet (SH.closeAcct): no tangerine edge, the line in ink-2, Keep it first in ink.
// B59.55 — under each agent's card, its one-time and standing cards with the budget the owner approved (Lens B59.21), and
// Open Approvals for one still waiting.
// B28.465 — Replace card and Cancel card beside Freeze card, each asked once in a sheet, in the web's words (B28.47): a
// replaced card is cancelled and its new one keeps its freeze and merchant lock; a cancelled one is gone for good.

type Entry = { agent: Agent; card: Held | null; purchases: CardAuthorization[]; rules: AgentRules; spends: CardSpend[] | null }

const money = (minor: number, currency: string) => formatMinor(minor, currency.toUpperCase())
const expiry = (card: Held) => `expires ${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)} · ${card.currency.toUpperCase()}`

export function frozenText(name: string, card: Held): string {
  return card.frozen
    ? `Frozen. Every purchase on ${name}’s card is refused, and nothing leaves its wallet, until you unfreeze it.`
    : `Unfrozen. ${name}’s card takes purchases again, each one judged by ${name}’s rules.`
}

export function replacedText(name: string, card: Held): string {
  return `Replaced. ${name}’s new card ends ${card.last4}. Every purchase on the old one is refused, and nothing leaves its wallet.`
}

export function cancelledText(name: string): string {
  return `Cancelled. Every purchase on ${name}’s card is refused, and nothing leaves its wallet. Issue it a new card here.`
}

type Ending = 'replace' | 'cancel'

/** B28.465 — asks once before the card is replaced or cancelled, as the web's EndCardDialog does. */
function EndCard({ ending, name, busy, onKeep, onEnd }: { ending: Ending | null; name: string; busy: boolean; onKeep: () => void; onEnd: () => void }) {
  const replace = ending === 'replace'
  return (
    <BottomSheet visible={ending !== null} onClose={onKeep} testID="end-card-sheet" edge={false}>
      <Headline style={{ fontSize: 22, lineHeight: 28, letterSpacing: -0.44 }}>{replace ? `Replace ${name}’s card?` : `Cancel ${name}’s card?`}</Headline>
      <Body muted>
        {replace
          ? `${name}’s card is cancelled at once, and a new one is issued to the same cardholder. Its freeze and its merchant lock carry over to the new card.`
          : `${name}’s card is cancelled for good. Every purchase on it is refused, and ${name} has no card until you issue it a new one.`}
      </Body>
      <Button variant="primary" label="Keep it" disabled={busy} onPress={onKeep} />
      <Button variant={replace ? 'secondary' : 'soft-danger'} label={replace ? 'Replace card' : 'Cancel card'} disabled={busy} onPress={onEnd} />
    </BottomSheet>
  )
}

/** B61.77 — Show card details checks it is you, then the details open in a sheet over the card; closing it hides them. */
function Details({ card, shown, onShow, onHide }: { card: Held; shown: boolean; onShow: () => void; onHide: () => void }) {
  return (
    <Card>
      <Eyebrow>Card details</Eyebrow>
      <Body muted>Hidden until you check it is you with {biometricName}.</Body>
      <Button label="Show card details" onPress={onShow} />
      <BottomSheet visible={shown} onClose={onHide} testID="card-details-sheet">
        <Headline>Card details</Headline>
        <View testID="card-details">
          <Figure size={20}>•••• {card.last4}</Figure>
          <Body muted>{expiry(card)}</Body>
        </View>
        <Button label="Hide card details" onPress={onHide} />
      </BottomSheet>
    </Card>
  )
}

function Purchases({ purchases }: { purchases: CardAuthorization[] }) {
  if (!purchases.length) {
    return <Body muted>No purchases yet. Each one appears here when the agent pays with this card, with what its rules decided and why.</Body>
  }
  return (
    <Card>
      {purchases.map((a, i) => (
        <Row
          key={a.id}
          first={i === 0}
          title={a.merchant_name || 'A merchant'}
          sub={a.reason}
          right={
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Figure>{money(a.amount_minor, a.currency)}</Figure>
              <Chip tone={a.approved ? 'good' : 'bad'}>{a.approved ? 'Approved' : 'Declined'}</Chip>
            </View>
          }
        />
      ))}
    </Card>
  )
}

export default function Cards() {
  const { client, peg } = useSession()
  const { width } = useWindowDimensions()
  const load = useCallback(async () => {
    // The disputes and refunds only add to each card: a read that fails says so under each card, and raises nothing.
    // The account's name only words the owner's card: a read that fails draws the agents' cards without it.
    const [book, disputes, refunds, name] = await Promise.all([
      client.book(),
      client.cardDisputes().catch(() => null),
      client.cardRefunds().catch(() => null),
      client.workspaceName().then((w) => w.name || null, () => null),
    ])
    const agents = (book.agents ?? []).filter((a) => !a.archived_at)
    const entries = await Promise.all(
      agents.map(async (agent): Promise<Entry> => {
        // The one-time and standing cards only add to the card: a read that fails says so under it, and raises nothing.
        const [held, rules, spends] = await Promise.all([client.card(agent.id), client.rules(agent.id), client.cardSpends(agent.id).catch(() => null)])
        return { agent, card: held?.card ?? null, purchases: held?.authorizations ?? [], rules, spends }
      }),
    )
    return { entries, disputes, refunds, name }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const { account } = useAccount(client)
  // Whose cardholder form is open.
  const [issuing, setIssuing] = useState<string | null>(null)
  // Whose details show, and only until you leave the tab.
  const [shown, setShown] = useState<string | null>(null)
  useFocusEffect(useCallback(() => () => setShown(null), []))
  // The sheet is its own window, drawn above the Cover, so the details go the moment the app leaves the front.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setShown(null)
    })
    return () => sub.remove()
  }, [])
  const [said, setSaid] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Whose card is being replaced or cancelled, while the sheet asks.
  const [ending, setEnding] = useState<{ id: string; how: Ending } | null>(null)

  const show = async (id: string) => {
    const got = await checkItsYou('Show the card details')
    if (got === 'ok') return setShown(id), setSaid(null)
    if (got === 'gone') return setSaid({ id, text: keyGoneText })
    if (got === 'off') return setSaid({ id, text: `Card details show after ${biometricName}. Turn approving on in Approvals first.` })
  }

  const freeze = async ({ agent, card }: Entry) => {
    setBusy(agent.id)
    try {
      const got = card?.frozen ? await client.unfreezeCard(agent.id) : await client.freezeCard(agent.id)
      play(card?.frozen ? 'unfreeze' : 'freeze')
      setSaid({ id: agent.id, text: frozenText(agent.name, got) })
      reload()
    } catch (err) {
      if (err instanceof BffError) outcome('refused')
      setSaid({ id: agent.id, text: refusalText(err) })
    } finally {
      setBusy(null)
    }
  }

  const end = async ({ agent }: Entry, how: Ending) => {
    setBusy(agent.id)
    try {
      const got = how === 'replace' ? await client.replaceCard(agent.id) : await client.cancelCard(agent.id)
      setSaid({ id: agent.id, text: how === 'replace' ? replacedText(agent.name, got) : cancelledText(agent.name) })
    } catch (err) {
      setSaid({ id: agent.id, text: refusalText(err) })
    } finally {
      setBusy(null)
      setEnding(null)
      setShown(null)
      reload()
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Cards</Eyebrow>
      <Headline>Your agents’ cards</Headline>
      <LoadState loading={loading && !data} error={error} />
      {account && data?.name ? (
        <View testID="owner-card" style={{ gap: 8 }}>
          <Eyebrow>{account.account_type === 'business' ? 'The company’s card' : 'Your card'}</Eyebrow>
          <View accessible accessibilityLabel={`${data.name}'s card`}>
            <OwnerCard account={account} holder={data.name} width={width - 36} />
          </View>
        </View>
      ) : null}
      <Button testID="cards-disputes" label={DISPUTE_WORDS.title} onPress={() => router.push('/disputes')} />
      {data && !data.entries.length ? <Body muted>No agents yet.</Body> : null}
      {(data?.entries ?? []).map((h) => (
        <View key={h.agent.id} style={{ gap: 12 }} testID={`card-${h.agent.id}`}>
          <View testID={`card-head-${h.agent.id}`}>
            <Card>
              <AgentCard agent={h.agent} width={width - 76} frozen={!!h.card?.frozen} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
                <View style={{ flexShrink: 1 }}>
                  <Headline>{h.agent.name}</Headline>
                </View>
                {h.card?.frozen ? <Chip tone="paused">Frozen</Chip> : null}
              </View>
              {h.card ? (
                <>
                  <Toggle label="Freeze card" value={!!h.card.frozen} disabled={busy === h.agent.id} onValueChange={() => void freeze(h)} />
                  <Button variant="secondary" label="Replace card" disabled={busy === h.agent.id} onPress={() => setEnding({ id: h.agent.id, how: 'replace' })} />
                  <Button variant="soft-danger" label="Cancel card" disabled={busy === h.agent.id} onPress={() => setEnding({ id: h.agent.id, how: 'cancel' })} />
                  <EndCard
                    ending={ending?.id === h.agent.id ? ending.how : null}
                    name={h.agent.name}
                    busy={busy === h.agent.id}
                    onKeep={() => setEnding(null)}
                    onEnd={() => ending && void end(h, ending.how)}
                  />
                </>
              ) : issuing === h.agent.id ? (
                <IssueCard
                  client={client}
                  agent={h.agent}
                  onIssued={() => {
                    setIssuing(null)
                    reload()
                  }}
                />
              ) : (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Icon name="card" />
                    <Body muted>No card for {h.agent.name} yet.</Body>
                  </View>
                  <Button label="Issue a card" accessibilityLabel={`Issue ${h.agent.name} a card`} onPress={() => setIssuing(h.agent.id)} />
                </>
              )}
              {said?.id === h.agent.id ? (
                <View accessibilityRole="alert">
                  <Body>{said.text}</Body>
                </View>
              ) : null}
            </Card>
          </View>
          <CardSpends spends={h.spends} />
          {h.card ? (
            <>
              <Details card={h.card} shown={shown === h.agent.id} onShow={() => void show(h.agent.id)} onHide={() => setShown(null)} />
              <View testID={`card-limits-${h.agent.id}`}>
                <CardLimits client={client} agent={h.agent} rules={h.rules} peg={peg} onSaved={reload} />
              </View>
              <Eyebrow>Purchases</Eyebrow>
              <Purchases purchases={h.purchases} />
              {data!.disputes && data!.refunds ? (
                <DisputesAndRefunds
                  disputes={data!.disputes.filter((d) => d.agent_id === h.agent.id)}
                  refunds={data!.refunds.filter((r) => r.agent_id === h.agent.id)}
                />
              ) : (
                <Body muted>{DISPUTE_WORDS.readFailed}</Body>
              )}
            </>
          ) : null}
        </View>
      ))}
    </Screen>
  )
}
