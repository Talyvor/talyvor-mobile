import type { AgentApproval } from '@talyvor/bff-client'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'

import { ApprovalCard } from '@/components/approval-card'
import { approvalCapability } from '@/components/money-label'
import { Body, Eyebrow, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

const DECIDED: Record<string, string> = { approved: 'Approved', denied: 'Declined', used: 'Approved and spent' }

/** How a decided approval ended, in a sentence. */
function ended(a: AgentApproval) {
  if (a.status === 'expired') return a.decided_at ? 'Expired: approved, but not used within 24 hours' : 'Expired: nobody answered within 24 hours'
  return DECIDED[a.status] ?? 'Closed'
}

/** One agent's held payment or request, where its notification lands: approve or decline it here. */
export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const load = useCallback(async () => {
    const [book, approvals] = await Promise.all([client.book(), client.approvals()])
    const approval = (approvals.approvals ?? []).find((a) => a.id === id) ?? null
    return { approval, agents: book.agents ?? [], agentName: book.agents?.find((a) => a.id === approval?.agent_id)?.name ?? approval?.agent_id ?? '' }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const [said, setSaid] = useState('')
  // B55.20: what a decline did, said once its card is gone.
  const afterDecision = (what?: string) => {
    setSaid(what ?? '')
    reload()
  }
  const a = data?.approval
  const agentName = data?.agentName ?? ''

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Approval</Eyebrow>
      <Headline>{!a ? 'Approval' : a.status === 'pending' ? `${agentName} is waiting for you` : `${agentName}’s request`}</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data && !a ? <Body muted>There is no approval at this address. It may belong to another workspace.</Body> : null}
      {a?.status === 'pending' ? <ApprovalCard approval={a} agentName={agentName} capability={approvalCapability(a, data?.agents ?? [])} onDecided={afterDecision} /> : null}
      {said ? <Body>{said}</Body> : null}
      {a && a.status !== 'pending' ? <Body muted>{ended(a)}. Nothing is waiting for you here.</Body> : null}
    </Screen>
  )
}
