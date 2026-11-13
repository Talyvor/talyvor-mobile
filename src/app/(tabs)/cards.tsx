import { formatMinor, refusalText, type Agent, type AgentCard as Held, type AgentRules, type CardAuthorization } from '@talyvor/bff-client'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { useWindowDimensions, View } from 'react-native'

import { useAccount } from '@/account'
import { AgentCard } from '@/components/card'
import { DisputesAndRefunds } from '@/components/card-disputes'
import { CardLimits, IssueCard } from '@/components/card-forms'
import { Icon } from '@/components/icon'
import { OwnerCard } from '@/components/owner-card'
import { Body, Button, Card, Chip, Eyebrow, Figure, Headline, LoadState, Row, Screen, Toggle, useLoad } from '@/components/ui'
import { DISPUTE_WORDS } from '@/dispute-words'
import { biometricName, checkItsYou, keyGoneText } from '@/keys'
import { useSession } from '@/session'

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

type Entry = { agent: Agent; card: Held | null; purchases: CardAuthorization[]; rules: AgentRules }

const money = (minor: number, currency: string) => formatMinor(minor, currency.toUpperCase())
const expiry = (card: Held) => `expires ${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)} · ${card.currency.toUpperCase()}`

export function frozenText(name: string, card: Held): string {
  return card.frozen
    ? `Frozen. Every purchase on ${name}’s card is refused, and nothing leaves its wallet, until you unfreeze it.`
    : `Unfrozen. ${name}’s card takes purchases again, each one judged by ${name}’s rules.`
}

function Details({ card, shown, onShow, onHide }: { card: Held; shown: boolean; onShow: () => void; onHide: () => void }) {
  return (
    <Card>
      <Eyebrow>Card details</Eyebrow>
      {shown ? (
        <View testID="card-details">
          <Figure size={20}>•••• {card.last4}</Figure>
          <Body muted>{expiry(card)}</Body>
        </View>
      ) : (
        <Body muted>Hidden until you check it is you with {biometricName}.</Body>
      )}
      <Button label={shown ? 'Hide card details' : 'Show card details'} onPress={shown ? onHide : onShow} />
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
        const [held, rules] = await Promise.all([client.card(agent.id), client.rules(agent.id)])
        return { agent, card: held?.card ?? null, purchases: held?.authorizations ?? [], rules }
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
  const [said, setSaid] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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
      setSaid({ id: agent.id, text: frozenText(agent.name, got) })
      reload()
    } catch (err) {
      setSaid({ id: agent.id, text: refusalText(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Cards</Eyebrow>
      <Headline>Your agents’ cards</Headline>
      <Button label={DISPUTE_WORDS.title} onPress={() => router.push('/disputes')} />
      <LoadState loading={loading && !data} error={error} />
      {account && data?.name ? (
        <View testID="owner-card">
          <Card>
            <Eyebrow>{account.account_type === 'business' ? 'The company’s card' : 'Your card'}</Eyebrow>
            <View accessible accessibilityLabel={`${data.name}'s card`}>
              <OwnerCard account={account} holder={data.name} width={width - 76} />
            </View>
          </Card>
        </View>
      ) : null}
      {data && !data.entries.length ? <Body muted>No agents yet.</Body> : null}
      {(data?.entries ?? []).map((h) => (
        <View key={h.agent.id} style={{ gap: 12 }} testID={`card-${h.agent.id}`}>
          <View testID={`card-head-${h.agent.id}`}>
            <Card>
              <AgentCard agent={h.agent} width={width - 76} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
                <View style={{ flexShrink: 1 }}>
                  <Headline>{h.agent.name}</Headline>
                </View>
                {h.card?.frozen ? <Chip tone="paused">Frozen</Chip> : null}
              </View>
              {h.card ? (
                <Toggle label="Freeze card" value={!!h.card.frozen} disabled={busy === h.agent.id} onValueChange={() => void freeze(h)} />
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
