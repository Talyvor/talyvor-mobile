import { formatULXC, refusalText, rulesInWords } from '@talyvor/bff-client'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { View } from 'react-native'

import { Body, Button, Eyebrow, Figure, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { useTheme } from '@/theme'

/** One agent: what it holds, its rules in plain words, and pause or resume. */
export default function AgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [book, rules] = await Promise.all([client.book(), client.rules(id)])
    return { agent: (book.agents ?? []).find((a) => a.id === id) ?? null, rules }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const agent = data?.agent

  const toggle = async () => {
    if (!agent) return
    setBusy(true)
    setRefusal('')
    try {
      if (agent.paused_at) await client.resume(agent.id)
      else await client.pause(agent.id, 'Paused from the phone app')
      reload()
    } catch (err) {
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }

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
          <Eyebrow>Rules</Eyebrow>
          {rulesInWords(data.rules).map((r) => (
            <Body key={r}>{r}</Body>
          ))}
        </>
      ) : null}
    </Screen>
  )
}
