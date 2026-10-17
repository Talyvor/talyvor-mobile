import { formatULXC, parseLXC, refusalText, rulesInWords } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { TextInput, View } from 'react-native'

import { Body, Button, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'
import { pinnedAgents, setPinned, syncWidget } from '@/widget-sync'

/** One agent: what it holds, its rules in plain words, pause or resume, fund, and its place on the home-screen widget. */
export default function AgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [book, rules, pins] = await Promise.all([client.book(), client.rules(id), pinnedAgents()])
    return { agent: (book.agents ?? []).find((a) => a.id === id) ?? null, rules, unallocated: book.unallocated_ulxc, pinned: pins.includes(id) }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [amount, setAmount] = useState('')
  // One key per amount typed, so a retry after a dropped answer funds once.
  const [fundKey, setFundKey] = useState(() => Crypto.randomUUID())
  const agent = data?.agent

  const act = async (write: () => Promise<unknown>) => {
    setBusy(true)
    setRefusal('')
    try {
      await write()
      reload()
      void syncWidget(client)
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  const toggle = () =>
    act(() => (agent!.paused_at ? client.resume(agent!.id) : client.pause(agent!.id, 'Paused from the phone app')))
  const micros = parseLXC(amount)
  const fund = () =>
    act(async () => {
      await client.fund(agent!.id, micros!, fundKey)
      setAmount('')
      setFundKey(Crypto.randomUUID())
    })
  const pin = () => act(() => setPinned(agent!.id, !data!.pinned))

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <LoadState loading={loading && !data} error={error} />
      {data && !agent ? <Body muted>This agent is not in your workspace.</Body> : null}
      {agent ? (
        <>
          <Eyebrow>Agent</Eyebrow>
          <Headline>{agent.name}</Headline>
          {agent.description ? <Body muted>{agent.description}</Body> : null}
          <Eyebrow>Balance</Eyebrow>
          <Figure size={32}>{formatULXC(agent.balance_ulxc)}</Figure>
          <Body muted>Spent so far: {formatULXC(agent.spent_ulxc)}</Body>
          <Body style={{ color: agent.paused_at ? c.caution : c.positive }}>
            {agent.paused_at ? `Paused${agent.paused_reason ? ` — ${agent.paused_reason}` : ''}. It can spend nothing until you resume it.` : 'Active.'}
          </Body>
          <View style={{ marginTop: 8 }}>
            <Button primary={!!agent.paused_at} label={agent.paused_at ? 'Resume' : 'Pause'} disabled={busy} onPress={() => void toggle()} />
          </View>
          {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
          <Eyebrow>Fund</Eyebrow>
          <Body muted>Unallocated in your workspace: {formatULXC(data.unallocated)}</Body>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              accessibilityLabel="Amount in LXC"
              placeholder="Amount in LXC"
              placeholderTextColor={c.inkMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={(v) => {
                setAmount(v)
                setFundKey(Crypto.randomUUID())
              }}
              style={{ flex: 1, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 6, paddingHorizontal: 12, color: c.ink, fontFamily: fonts.mono, fontSize: 15 }}
            />
            <Button label="Fund" disabled={busy || micros === null} onPress={() => void fund()} />
          </View>
          <Eyebrow>Home-screen widget</Eyebrow>
          <Body muted>{data.pinned ? 'Pinned: it shows on your home-screen widget with Pause and Fund.' : 'Pin it to show it on your home-screen widget.'}</Body>
          <Button label={data.pinned ? 'Unpin from widget' : 'Pin to widget'} disabled={busy} onPress={() => void pin()} />
          <Eyebrow>Rules</Eyebrow>
          {rulesInWords(data.rules).map((r) => (
            <Body key={r}>{r}</Body>
          ))}
        </>
      ) : null}
    </Screen>
  )
}
