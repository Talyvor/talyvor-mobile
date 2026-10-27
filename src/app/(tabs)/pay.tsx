import { Link } from 'expo-router'
import { useCallback } from 'react'
import { Pressable, View } from 'react-native'

import { Body, Card, Eyebrow, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { lastPaid } from '@/widget-sync'

/** Your saved payees, each with its last payment; a tap opens its payment screen. */
export default function PayScreen() {
  const { client } = useSession()
  const load = useCallback(async () => {
    const [payees, payments] = await Promise.all([client.payees(), client.payments()])
    return { payees: payees.payees ?? [], payments: payments.payments ?? [] }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Eyebrow>Pay</Eyebrow>
      <Headline>Saved payees</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data && data.payees.length === 0 ? <Body muted>No saved payees yet. Add one in Talyvor on the web.</Body> : null}
      {(data?.payees ?? []).map((p) => (
        <Link key={p.id} href={{ pathname: '/payees/[id]', params: { id: p.id } }} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={`Pay ${p.name}`}>
            <Card>
              <View style={{ gap: 2 }}>
                <Body>{p.name}</Body>
                <Body muted>{lastPaid(data!.payments, p.id)}</Body>
              </View>
            </Card>
          </Pressable>
        </Link>
      ))}
    </Screen>
  )
}
