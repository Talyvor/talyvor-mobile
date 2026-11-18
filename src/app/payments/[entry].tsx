import { type SpendPayment } from '@talyvor/bff-client'
import { useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'

import { PaymentReceipt } from '@/components/payment-proof'
import { whoseOf } from '@/components/spending'
import { Back, Body, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'

const DAY = 24 * 60 * 60 * 1000

/** B62.4 — a payment's screen, opened from Spending's payments: the payment, the agent's task and its proof (Lens B62.1),
 * the web's B62.3 in the phone's layout. `at` is when it was made, so its month's payments are the ones read.
 * B57.191 — drawn as the P10 receipt, under Payment as Instant transfer's draws its Receipt. */
export default function PaymentScreen() {
  const { entry, at } = useLocalSearchParams<{ entry: string; at?: string }>()
  const { client } = useSession()
  const load = useCallback(async (): Promise<{ payment: SpendPayment | null; agents: { id: string; name: string }[] }> => {
    const t = at ? new Date(at).getTime() : Date.now()
    const [spending, book] = await Promise.all([client.spending(new Date(t - DAY).toISOString(), new Date(t + DAY).toISOString()), client.book()])
    return { payment: (spending.payments ?? []).find((p) => p.entry_id === entry) ?? null, agents: book.agents ?? [] }
  }, [client, entry, at])
  const { data, error, loading, reload } = useLoad(load)
  const p = data?.payment

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/spending" to="Spending" />
      <Headline>Payment</Headline>
      <LoadState loading={loading && !data} error={error} />
      {data && !p ? <Body muted>There is no payment at this address. It may belong to another workspace.</Body> : null}
      {data && p ? <PaymentReceipt payment={p} whose={whoseOf(data.agents)(p.agent_id)} /> : null}
    </Screen>
  )
}
