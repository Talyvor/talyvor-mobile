import { BffError, type AgentRules, type AgentSummary, formatLXC, refusalText, rulesInWords, rulesSave } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useState } from 'react'
import { useWindowDimensions, View } from 'react-native'

import { useAccount } from '../account'
import { WORDS as INSTANT_WORDS } from '../instant-transfer'
import { biometricName, keyGone, keyGoneText, phoneKey, resumeWithThisPhone, signWithThisPhone } from '../keys'
import { useSession } from '../session'
import { useTheme } from '../theme'
import { setPinned, syncWidget } from '../widget-sync'
import { PendingApprovals } from './approval-card'
import { AgentCard } from './card'
import { Icon } from './icon'
import { Money } from './money'
import { AGENT_CREDIT, MoneyHeader } from './money-label'
import { BottomSheet } from './pay-sheet'
import { StartEveryAgentButton, StartEveryAgentSheet } from './start-every-agent'
import { balancesByCurrency } from './home'
import { Body, Button, Card, Chip, Eyebrow, Headline, Toggle } from './ui'

// B57.70 — an agent's screen as Pocket draws it (design/pocket p-agent-research and its sheet presume-research): this
// month's spend from the agent's one read (Lens B57.12, BFF B57.20), what waits for it with Review, its balance and
// state, Pause at once, Resume signed with this phone's key over its resume challenge (B55.5), the widget pin as a
// switch, its rules in words and its statement. B61.15: its balance is what its currency accounts hold; its credit, and
// Fund, which moved credit to it, are the parked gateway's and are not drawn.

export type AgentData = {
  summary: AgentSummary
  rules: AgentRules
  pinned: boolean
  signs: boolean
}

/** One agent's screen; `onChanged` reads it again after a write. */
export function AgentView({ data, onChanged }: { data: AgentData; onChanged: () => void }) {
  const { client, peg } = useSession()
  const { c } = useTheme()
  const { width } = useWindowDimensions()
  const { summary, signs } = data
  const agent = summary.agent
  const paused = !!agent.paused_at
  const allPaused = !!summary.all_paused_at
  const pending = (summary.approvals ?? []).filter((a) => a.status === 'pending')
  const onWeb = `Resume ${agent.name} on the web with your passkey, or turn on Approve with ${biometricName} on this phone.`

  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [asking, setAsking] = useState(false)
  const [sheetSaid, setSheetSaid] = useState('')
  const [note, setNote] = useState('')
  const [starting, setStarting] = useState(false)
  // B59.20 — "Can use Instant transfer", off by default; only a Hybrid account has the switch.
  const shows = useAccount(client).shows
  const instant = shows?.instantTransfer === true
  const held = shows ? balancesByCurrency(summary.currency_accounts ?? [], shows) : []
  const [instantSaid, setInstantSaid] = useState('')

  const changed = () => {
    onChanged()
    void syncWidget(client)
  }
  const act = async (write: () => Promise<unknown>) => {
    setBusy(true)
    setRefusal('')
    try {
      await write()
      changed()
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  const pause = () => act(() => client.pause(agent.id, 'Paused from the phone app'))

  const closeSheet = () => {
    setAsking(false)
    setSheetSaid('')
  }
  // With this phone's key on, Face ID signs Lens's resume challenge; off, the resume goes unsigned, which Lens takes
  // only while the workspace has no key, and the sheet then says where to resume it.
  const resume = async () => {
    setBusy(true)
    setRefusal('')
    setSheetSaid('')
    const why = await resumeWithThisPhone(client, agent.id, `Resume ${agent.name}`, onWeb)
    setBusy(false)
    if (why === onWeb) return setAsking(true)
    if (why) return asking ? setSheetSaid(why) : setRefusal(why)
    closeSheet()
    if (allPaused) setNote(`${agent.name} runs when you start every agent again. Until then it stays paused with every agent.`)
    changed()
  }

  // Turning it on loosens the rules, so Lens takes it only signed with this phone's key over the change's challenge.
  // B61.88 — the rules go back in the currency Lens holds them in, each limit in its minor units, and no µLXC limit.
  const countable = !!data.rules.currency || !!peg
  const setInstant = (on: boolean) =>
    act(async () => {
      setInstantSaid('')
      const proposed = { ...rulesSave(data.rules, peg ?? 0), may_instant_transfer: on }
      try {
        const [j, key] = await Promise.all([client.rulesChallenge(agent.id, proposed), phoneKey(client)])
        let assertion
        if (j.looser && j.challenge) {
          if (!key?.here) return setInstantSaid(`Loosen ${agent.name}’s rules with ${biometricName} on this phone: turn approving on in Approvals first.`)
          assertion = await signWithThisPhone(client, j.challenge, `Let ${agent.name} use Instant transfer`)
        }
        await client.setRules(agent.id, proposed, assertion)
        setInstantSaid('Saved. Lens applies these rules to the next request or payment.')
      } catch (err) {
        if (keyGone(err)) setInstantSaid(keyGoneText)
        else if (err instanceof BffError) setInstantSaid(refusalText(err))
        else setInstantSaid('Cancelled. Nothing changed.')
      }
    })

  const state = paused ? 'Paused. It can spend nothing until you resume it.' : allPaused ? 'Paused with every agent.' : 'Running.'

  return (
    <>
      {/* B57.126 and B57.134: its card first, in Pocket's panel as W4 draws it, then its name and Running or Paused. */}
      <View testID="agent-head">
        <Card>
          <AgentCard agent={agent} width={Math.min(428, width - 76)} />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: 6,
            }}
          >
            <View style={{ flexShrink: 1 }}>
              <Headline>{agent.name}</Headline>
            </View>
            {paused || allPaused ? (
              <Chip tone="paused">Paused</Chip>
            ) : (
              <Chip tone="good" dot>
                Running
              </Chip>
            )}
          </View>
          {agent.description ? <Body muted>{agent.description}</Body> : null}
        </Card>
      </View>
      <Body muted>Spent this month: {formatLXC(summary.month.spent_ulxc, peg)}</Body>

      <PendingApprovals pending={pending} agents={[agent]} allPaused={allPaused} labels={false} onDecided={changed} />

      <Card>
        <MoneyHeader capability={AGENT_CREDIT}>Balance</MoneyHeader>
        {held.map((h) => (
          <Money key={h.currency} minor={h.minor} currency={h.currency} />
        ))}
        <Body style={paused || allPaused ? { color: c.caution } : undefined}>{state}</Body>
        {summary.card.status === 'frozen' ? <Body style={{ color: c.caution }}>Its card is frozen: every purchase on it is refused.</Body> : null}
      </Card>

      <View style={{ gap: 10, marginTop: 4 }}>
        {paused ? (
          <Button
            primary
            icon={signs ? 'faceid' : undefined}
            label={signs ? `Resume with ${biometricName}` : 'Resume'}
            disabled={busy}
            hint="Resuming…"
            onPress={() => (signs ? setAsking(true) : void resume())}
          />
        ) : null}
        {allPaused ? <StartEveryAgentButton signs={signs} busy={busy} onPress={() => setStarting(true)} /> : null}
        {!paused && !allPaused ? <Button variant="secondary" icon="pause" label="Pause" disabled={busy} hint="Pausing…" onPress={() => void pause()} /> : null}
      </View>
      {note ? <Body>{note}</Body> : null}
      {refusal ? <Body style={{ color: c.danger }}>{refusal}</Body> : null}

      <Card tight>
        <Toggle label="Pinned to your home-screen widget" value={data.pinned} disabled={busy} onValueChange={(on) => void act(() => setPinned(agent.id, on))} />
      </Card>

      <Card white>
        <Eyebrow>Rules</Eyebrow>
        {rulesInWords(data.rules, peg).map((r) => (
          <Body key={r}>{r}</Body>
        ))}
        {instant ? (
          <View testID="instant-rule" style={{ gap: 4 }}>
            <Toggle label={INSTANT_WORDS.canUse} value={data.rules.may_instant_transfer ?? false} disabled={busy || !countable} onValueChange={(on) => void setInstant(on)} />
            <Body muted style={{ fontSize: 13 }}>
              {INSTANT_WORDS.canUseLine(agent.name)}
            </Body>
            {instantSaid ? <Body>{instantSaid}</Body> : null}
          </View>
        ) : null}
      </Card>
      <Button label="Statement" onPress={() => router.push({ pathname: '/activity', params: { agent: agent.id } })} />

      <BottomSheet visible={asking} onClose={busy ? undefined : closeSheet}>
        <Headline>{`Resume ${agent.name}?`}</Headline>
        <Body muted>Its requests and payments are served again, within its rules.</Body>
        {allPaused ? <Body muted>{`Every agent is paused too, so ${agent.name} waits until you start every agent again.`}</Body> : null}
        {signs ? (
          <Button
            primary
            icon="faceid"
            label={busy ? 'Resuming…' : `Resume with ${biometricName}`}
            disabled={busy}
            hint="Resuming…"
            onPress={() => void resume()}
          />
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Icon name="faceid" size={16} color={c.ink2} />
              <Body muted style={{ flex: 1, fontSize: 13 }}>
                {onWeb}
              </Body>
            </View>
            <Button
              primary
              label="Approvals on this phone"
              onPress={() => {
                closeSheet()
                router.push('/approvals')
              }}
            />
          </>
        )}
        <Button variant="secondary" label="Not now" disabled={busy} hint="Resuming…" onPress={closeSheet} />
        {sheetSaid ? <Body style={{ color: c.danger }}>{sheetSaid}</Body> : null}
      </BottomSheet>
      <StartEveryAgentSheet
        visible={starting}
        signs={signs}
        onClose={() => setStarting(false)}
        onStarted={() => {
          setStarting(false)
          setNote('')
          changed()
        }}
      />
    </>
  )
}
