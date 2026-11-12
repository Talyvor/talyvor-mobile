import { BffError } from '@talyvor/bff-client'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect } from 'react'
import { Text } from 'react-native'

import { BillRows } from '@/components/bill-rows'
import { Back, Body, Card, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B40.17 — where "What's due in Talyvor" and "Pay my bills in Talyvor" land: the payments prepared for the person's
// approval. Nothing is paid here; "Pay my bills" goes straight to the approval card of the oldest request waiting, and
// each decided card offers the next.
//
// B57.78 — drawn as Pocket's p-bills, opened from Pay's Bills due: Back, the rows, and how a new one arrives.

export default function Bills() {
  const { pay } = useLocalSearchParams<{ pay?: string }>()
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => ((await client.pendingPaymentRequests()).requests ?? []).filter((r) => r.status === 'pending_approval'), [client])
  const { data, error, loading, reload } = useLoad(load)
  const unlisted = error instanceof BffError && (error.status === 404 || error.status === 405)

  useEffect(() => {
    // Lens lists newest first, so the oldest bill is the last.
    if (pay === '1' && data?.length) router.replace({ pathname: '/approve/[id]', params: { id: data[data.length - 1].id, pay: '1' } })
  }, [pay, data])

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/pay" />
      <Headline>Bills due</Headline>
      {unlisted ? <Body muted>Bills due cannot be listed here yet.</Body> : <LoadState loading={loading && !data} error={error} />}
      {data?.length ? <BillRows requests={data} /> : null}
      {data && data.length === 0 ? (
        <Card white tight>
          <Body muted>Nothing is due. A payment Chat or an assistant prepares for you waits here.</Body>
        </Card>
      ) : null}
      <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>Each payment prepared for you arrives as a notification that opens its approval card.</Text>
    </Screen>
  )
}
