import { useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'

import { takeApproved, takeRefusal } from '@/approve-batch'
import { ApprovedFromNotification, DecidedCard, PendingApprovals } from '@/components/approval-card'
import { UsedApprovalCard } from '@/components/payment-proof'
import { Back, Body, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { useTheme } from '@/theme'

/** One agent's held payment or request, where its notification lands: its approval sheet opens over it (B57.67), and the
 * other requests waiting follow it with Next. B57.78: one already decided or expired is Pocket's p-approval-landing, which
 * says so in words. B57.105: approved with Face ID on its notification, it lands on Pocket's Approved screen; refused, its
 * sheet says Nothing was approved in Lens's sentence. B62.11: one whose payment was stopped says why; a used one shows the
 * Proof of the payment it let through, read by the approval's id (Lens B62.9), with Copy the proof. B57.208: both drawn
 * in the request's card, in Pocket. */
export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  // What the notification's Approve with Face ID did, said once, here.
  const [approved, setApproved] = useState(() => takeApproved(id))
  const [refused] = useState(() => takeRefusal(id))
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
      {data && refused && a?.status !== 'pending' ? <Body style={{ color: c.critical }}>{refused}</Body> : null}
      {data ? <PendingApprovals pending={data.pending} agents={data.book.agents ?? []} allPaused={!!data.book.all_paused_at} focus={id} refused={refused} onDecided={reload} /> : null}
      {a?.status === 'used' ? <UsedApprovalCard approval={a} agentName={agentName} /> : a && a.status !== 'pending' ? <DecidedCard approval={a} agentName={agentName} /> : null}
      {data && a && approved && a.status !== 'pending' ? (
        <ApprovedFromNotification approval={a} agents={data.book.agents ?? []} allPaused={!!data.book.all_paused_at} pending={data.pending} onDone={() => setApproved(false)} />
      ) : null}
    </Screen>
  )
}
