import { BffError } from '@talyvor/bff-client'
import { useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'

import { AgentWalletView, type WalletAction } from '@/components/agent-wallet'
import { Back, Body, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

const ACTIONS: readonly WalletAction[] = ['top-up', 'cash-out', 'send', 'request', 'activity', 'limits']

/** B48.20 — one agent's wallets (components/agent-wallet.tsx). A push about its money lands here with the part it is
 * about open: `open` is one of ACTIONS. */
export default function AgentWalletScreen() {
  const { id, open } = useLocalSearchParams<{ id: string; open?: string }>()
  const { client } = useSession()
  const load = useCallback(async () => {
    // Lens answers 404 for an agent that is not in this workspace.
    const gone = (err: unknown) => {
      if (err instanceof BffError && err.status === 404) return null
      throw err
    }
    const [wallets, book] = await Promise.all([client.agentWallets(id).catch(gone), client.book()])
    const agent = (book.agents ?? []).find((a) => a.id === id)
    return wallets && agent ? { wallets, agent } : 'gone'
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const opens = ACTIONS.find((a) => a === open)
  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/" />
      <LoadState loading={loading && !data} error={error} />
      {data === 'gone' ? <Body muted>This agent is not in your workspace.</Body> : null}
      {data && data !== 'gone' ? <AgentWalletView agent={data.agent} wallets={data.wallets} opens={opens} /> : null}
    </Screen>
  )
}
