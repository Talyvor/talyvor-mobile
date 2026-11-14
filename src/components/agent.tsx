import { type AgentRules, type AgentSummary, formatLXC, parseLXC, refusalText, rulesInWords } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { router } from 'expo-router'
import { useState } from 'react'
import { TextInput, useWindowDimensions, View } from 'react-native'

import { biometricName, resumeWithThisPhone } from '../keys'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { setPinned, syncWidget } from '../widget-sync'
import { PendingApprovals } from './approval-card'
import { AgentCard } from './card'
import { Icon } from './icon'
import { Money, moneyParts } from './money'
import { AGENT_CREDIT, MoneyHeader } from './money-label'
import { BottomSheet } from './pay-sheet'
import { StartEveryAgentButton, StartEveryAgentSheet } from './start-every-agent'
import { Body, Button, Card, Chip, Eyebrow, Headline, Toggle } from './ui'

// B57.70 — an agent's screen as Pocket draws it (design/pocket p-agent-research and its sheet presume-research): this
// month's spend from the agent's one read (Lens B57.12, BFF B57.20), what waits for it with Review, its balance and
// state, Pause at once, Resume signed with this phone's key over its resume challenge (B55.5), Fund, the widget pin as
// a switch, its rules in words and its statement.

export type AgentData = {
  summary: AgentSummary
  rules: AgentRules
  unallocated: number
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
  const [amount, setAmount] = useState('')
  const [funded, setFunded] = useState('')
  // One key per amount typed, so a retry after a dropped answer funds once.
  const [fundKey, setFundKey] = useState(() => Crypto.randomUUID())
  const micros = parseLXC(amount)

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

  const fund = () =>
    act(async () => {
      await client.fund(agent.id, micros!, fundKey)
      setFunded(`Funded ${formatLXC(micros!, peg)} today.`)
      setAmount('')
      setFundKey(Crypto.randomUUID())
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
        <Money micros={agent.balance_ulxc} peg={peg} balance />
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

      <Card white>
        <Eyebrow>Fund</Eyebrow>
        <Body muted>Not yet given to an agent: {formatLXC(data.unallocated, peg)}</Body>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            accessibilityLabel="Amount in LXC"
            placeholder="Amount in LXC"
            placeholderTextColor={c.inkMuted}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={(v) => {
              setAmount(v)
              setFunded('')
              setFundKey(Crypto.randomUUID())
            }}
            style={{
              flex: 1,
              height: 52,
              borderWidth: 1,
              borderColor: c.lineStrong,
              borderRadius: 12,
              paddingHorizontal: 12,
              color: c.ink,
              fontFamily: fonts.ui,
              fontSize: 15,
            }}
          />
          <Button
            primary
            small
            label={micros === null ? 'Fund' : `Fund ${moneyParts(formatLXC(micros, peg)).large}`}
            disabled={busy || micros === null}
            hint="Type an amount first"
            onPress={() => void fund()}
          />
        </View>
        {funded ? <Body>{funded}</Body> : null}
      </Card>
      <Card tight>
        <Toggle label="Pinned to your home-screen widget" value={data.pinned} disabled={busy} onValueChange={(on) => void act(() => setPinned(agent.id, on))} />
      </Card>

      <Card white>
        <Eyebrow>Rules</Eyebrow>
        {rulesInWords(data.rules, peg).map((r) => (
          <Body key={r}>{r}</Body>
        ))}
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
