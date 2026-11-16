import { useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'

import { type NoticeData, NoticeView } from '@/components/spending'
import { LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

const DAY = 24 * 60 * 60 * 1000

/** B53.9 — where a spending notice lands (its push carries only the notice's id): the payment it is about. B57.92: drawn
 * in Pocket (components/spending.tsx). */
export default function NoticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const load = useCallback(async (): Promise<NoticeData> => {
    const [notices, book] = await Promise.all([client.notices(), client.book()])
    const notice = (notices.notices ?? []).find((n) => n.id === id) ?? null
    const entry = notice?.data?.entry_id
    if (!notice || !entry) return { notice, payment: null, agents: book.agents ?? [] }
    // A notice is written once its payment is read, so the payment is in the month before it.
    const at = new Date(notice.created_at).getTime()
    const spending = await client.spending(new Date(at - 31 * DAY).toISOString(), new Date(at + DAY).toISOString())
    return { notice, payment: (spending.payments ?? []).find((p) => p.entry_id === entry) ?? null, agents: book.agents ?? [] }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <NoticeView data={data} />
      <LoadState loading={loading && !data} error={error} />
    </Screen>
  )
}
