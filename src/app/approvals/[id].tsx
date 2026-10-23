import { useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'

import { ApprovalCard } from '@/components/approval-card'
import { Body, Eyebrow, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

const DECIDED = { approved: 'Approved', denied: 'Denied', used: 'Approved and spent' } as const

/** One agent's held payment or request, where its notification lands: approve or deny it here. */
export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const load = useCallback(async () => {
    const [book, approvals] = await Promise.all([client.book(), client.approvals()])
    const approval = (approvals.approvals ?? []).find((a) => a.id === id) ?? null
    return { approval, agentName: book.agents?.find((a) => a.id === approval?.agent_id)?.name ?? approval?.agent_id ?? '' }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const a = data?.approval
  const agentName = data?.agentName ?? ''

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Approval</Eyebrow>
      <Headline>{a ? `${agentName} is waiting for you` : 'Approval'}</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data && !a ? <Body muted>There is no approval at this address. It may belong to another workspace.</Body> : null}
      {a?.status === 'pending' ? <ApprovalCard approval={a} agentName={agentName} onDecided={reload} /> : null}
      {a && a.status !== 'pending' ? <Body muted>{DECIDED[a.status]}. Nothing is waiting for you here.</Body> : null}
    </Screen>
  )
}
