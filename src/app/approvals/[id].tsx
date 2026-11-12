import { useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'

import { DecidedCard, PendingApprovals } from '@/components/approval-card'
import { Back, Body, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

/** One agent's held payment or request, where its notification lands: its approval sheet opens over it (B57.67), and the
 * other requests waiting follow it with Next. B57.78: one already decided or expired is Pocket's p-approval-landing, which
 * says so in words. */
export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const load = useCallback(async () => {
    const [book, approvals] = await Promise.all([client.book(), client.approvals()])
    const all = approvals.approvals ?? []
    const approval = all.find((a) => a.id === id) ?? null
    // This request first, so Next after it goes on to the others.
    const pending = all.filter((a) => a.status === 'pending').sort((x, y) => Number(y.id === id) - Number(x.id === id))
    return { approval, pending, book, agentName: book.agents?.find((a) => a.id === approval?.agent_id)?.name ?? approval?.agent_id ?? '' }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const a = data?.approval
  const agentName = data?.agentName ?? ''

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/approvals" />
      <Headline>{!a ? 'Approval' : a.status === 'pending' ? `${agentName} is waiting for you` : `${agentName}’s request`}</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data && !a ? <Body muted>There is no approval at this address. It may belong to another workspace.</Body> : null}
      {data ? <PendingApprovals pending={data.pending} agents={data.book.agents ?? []} allPaused={!!data.book.all_paused_at} focus={id} onDecided={reload} /> : null}
      {a && a.status !== 'pending' ? <DecidedCard approval={a} agentName={agentName} /> : null}
    </Screen>
  )
}
