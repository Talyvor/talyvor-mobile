import { BffError, type AgentRules, type AgentSummary, formatLXC, refusalText, rulesInWords, rulesSave } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useAccount } from '../account'
import { WORDS as INSTANT_WORDS } from '../instant-transfer'
import { biometricName, keyGone, keyGoneText, phoneKey, resumeWithThisPhone, signWithThisPhone } from '../keys'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { setPinned, syncWidget } from '../widget-sync'
import { PendingApprovals } from './approval-card'
import { AgentFundingSheet, type FundingDirection } from './agent-funding'
import { Face } from './face'
import { Icon, type IconName } from './icon'
import { Money } from './money'
import { FlightTarget } from './picture-flight'
import { AGENT_CREDIT, MoneyHeader } from './money-label'
import { BottomSheet } from './pay-sheet'
import { StartEveryAgentButton, StartEveryAgentSheet } from './start-every-agent'
import { balancesByCurrency } from './home'
import { Body, Button, Card, Chip, Eyebrow, Headline, Row, Toggle } from './ui'

// B57.70 — an agent's screen as Pocket draws it (design/pocket p-agent-research and its sheet presume-research): this
// month's spend from the agent's one read (Lens B57.12, BFF B57.20), what waits for it with Review, its balance and
// state, Pause at once, Resume signed with this phone's key over its resume challenge (B55.5), the widget pin as a
// switch, its rules in words and its statement. B61.15: its balance is what its currency accounts hold; its credit, and
// Fund, which moved credit to it, are the parked gateway's and are not drawn.
// B61.85 — as Pocket Live's agent page: its round actions are Add money, Take back, Pause (or Resume) and Rules, in that
// order; Add money and Take back move money between the company's account and the agent's (agent-funding.tsx), Rules
// opens its rules in words; its card is a row under this month's spend.

export type AgentData = {
  summary: AgentSummary
  rules: AgentRules
  pinned: boolean
  signs: boolean
}

/** One agent's screen; `onChanged` reads it again after a write. */
/** `opens` draws the screen with a sheet open, as the home-screen widget's Resume and Fund ask (B57.77). */
export function AgentView({ data, onChanged, opens }: { data: AgentData; onChanged: () => void; opens?: 'resume' | 'fund' }) {
  const { client, peg } = useSession()
  const { c } = useTheme()
  const { summary, signs } = data
  const agent = summary.agent
  const paused = !!agent.paused_at
  const allPaused = !!summary.all_paused_at
  const pending = (summary.approvals ?? []).filter((a) => a.status === 'pending')
  const onWeb = `Resume ${agent.name} on the web with your passkey, or turn on Approve with ${biometricName} on this phone.`

  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [asking, setAsking] = useState(opens === 'resume' && paused)
  const [sheetSaid, setSheetSaid] = useState('')
  const [note, setNote] = useState('')
  const [starting, setStarting] = useState(false)
  // B59.20 — "Can use Instant transfer", off by default; only a Hybrid account has the switch.
  const shows = useAccount(client).shows
  const instant = shows?.instantTransfer === true
  const held = shows ? balancesByCurrency(summary.currency_accounts ?? [], shows) : []
  const [instantSaid, setInstantSaid] = useState('')
  const [funding, setFunding] = useState<FundingDirection | null>(opens === 'fund' ? 'to_agent' : null)
  const [moved, setMoved] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)

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
      {/* B61.85: its face, its name and Running or Paused; its card is a row under This month. */}
      <View testID="agent-head">
        <Card>
          <FlightTarget agentId={agent.id}>
            <Face agent={agent} state={paused || allPaused ? 'asleep' : 'happy'} size={60} />
          </FlightTarget>
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-around' }} testID="agent-actions">
        <Round icon="plus" label="Add money" accessibilityLabel={`Add money to ${agent.name}`} onPress={() => setFunding('to_agent')} />
        <Round icon="download" label="Take back" accessibilityLabel={`Take back from ${agent.name}`} onPress={() => setFunding('to_company')} />
        {paused ? (
          <Round icon={signs ? 'faceid' : 'arrow'} label={signs ? `Resume with ${biometricName}` : 'Resume'} disabled={busy} hint="Resuming…" onPress={() => (signs ? setAsking(true) : void resume())} />
        ) : !allPaused ? (
          <Round icon="pause" label="Pause" disabled={busy} hint="Pausing…" onPress={() => void pause()} />
        ) : null}
        <Round icon="settings" label="Rules" accessibilityLabel={`${agent.name}’s rules`} onPress={() => setRulesOpen(true)} />
      </View>
      {moved ? <Body>{moved}</Body> : null}
      {allPaused ? <StartEveryAgentButton signs={signs} busy={busy} onPress={() => setStarting(true)} /> : null}
      {note ? <Body>{note}</Body> : null}
      {refusal ? <Body style={{ color: c.danger }}>{refusal}</Body> : null}

      <Body muted>Spent this month: {formatLXC(summary.month.spent_ulxc, peg)}</Body>
      <Card white>
        <Row first left={<Icon name="card" color={c.ink} />} title={`${agent.name}’s card`} sub="Freeze, details and limits" right={<Icon name="chev" color={c.ink3} />} onPress={() => router.push('/cards')} />
      </Card>

      <PendingApprovals pending={pending} agents={[agent]} allPaused={allPaused} labels={false} onDecided={changed} />

      <Card>
        <MoneyHeader capability={AGENT_CREDIT}>Balance</MoneyHeader>
        {held.map((h) => (
          <Money key={h.currency} minor={h.minor} currency={h.currency} />
        ))}
        <Body style={paused || allPaused ? { color: c.caution } : undefined}>{state}</Body>
        {summary.card.status === 'frozen' ? <Body style={{ color: c.caution }}>Its card is frozen: every purchase on it is refused.</Body> : null}
      </Card>


      <Card tight>
        <Toggle label="Pinned to your home-screen widget" value={data.pinned} disabled={busy} onValueChange={(on) => void act(() => setPinned(agent.id, on))} />
      </Card>

      <Button label="Statement" onPress={() => router.push({ pathname: '/activity', params: { agent: agent.id } })} />

      <BottomSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} testID="agent-rules">
        <Headline>{`${agent.name}’s rules`}</Headline>
        <Body muted>{`${agent.name} pays on its own inside these rules. Anything outside them waits for your yes.`}</Body>
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
      </BottomSheet>
      <AgentFundingSheet
        agent={agent}
        direction={funding}
        onClose={() => setFunding(null)}
        onDone={(said) => {
          setMoved(said)
          changed()
        }}
      />

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

/** One of the agent's round actions, as Home's quick actions draw them: a 48-wide circle over its word. */
function Round({ icon, label, accessibilityLabel, disabled, hint, onPress }: { icon: IconName; label: string; accessibilityLabel?: string; disabled?: boolean; hint?: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      accessibilityHint={disabled ? hint : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ alignItems: 'center', gap: 6, minWidth: 72 }, (pressed || disabled) && { opacity: 0.6 }]}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.cloud, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={c.ink} />
      </View>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: c.ink, maxWidth: 84, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  )
}
