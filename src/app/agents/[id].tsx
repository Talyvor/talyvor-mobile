import { BffError } from '@talyvor/bff-client'
import { useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'

import { AgentView } from '@/components/agent'
import { Back, Body, LoadState, Screen, useLoad } from '@/components/ui'
import { phoneKey } from '@/keys'
import { useSession } from '@/session'
import { pinnedAgents } from '@/widget-sync'

/** One agent (B57.70): its page in one read, with what it holds, what waits, pause or resume, fund, its widget pin and
 * its rules. */
export default function AgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const load = useCallback(async () => {
    // Lens answers 404 for an agent that is not in this workspace.
    const gone = (err: unknown) => {
      if (err instanceof BffError && err.status === 404) return null
      throw err
    }
    const [summary, rules, pins, device] = await Promise.all([
      client.summary(id).catch(gone),
      client.rules(id).catch(gone),
      pinnedAgents(),
      phoneKey(client),
    ])
    return summary && rules
      ? {
          summary,
          rules,
          pinned: pins.includes(id),
          signs: !!device?.here,
        }
      : 'gone'
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/" />
      <LoadState loading={loading && !data} error={error} />
      {data === 'gone' ? <Body muted>This agent is not in your workspace.</Body> : null}
      {data && data !== 'gone' ? <AgentView data={data} onChanged={reload} /> : null}
    </Screen>
  )
}
