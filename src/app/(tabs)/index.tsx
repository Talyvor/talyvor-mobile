import type { BffClient } from '@talyvor/bff-client'
import { useCallback, useEffect } from 'react'

import { useAccount } from '@/account'
import { HomeError, HomeHeader, HomeLoading, HomeView } from '@/components/home'
import { KeyRecoveryCard } from '@/components/key-recovery-card'
import { pendingPrepared } from '@/components/prepared-payment-card'
import { Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { setWaiting } from '@/waiting'
import { syncWidget } from '@/widget-sync'

/** The account's name for its pill; a read that fails draws the pill without it. */
const nameOf = (client: BffClient) => client.workspaceName().then((w) => w.name || null, () => null)

/** Home (B57.66): the account, what it holds, what waits for your yes, the cards, then each agent. */
export default function Home() {
  const { client, peg } = useSession()
  const load = useCallback(async () => {
    const [book, approvals, prepared, accounts, name] = await Promise.all([client.book(), client.approvals(), pendingPrepared(client), client.moneyAccounts(), nameOf(client)])
    return { book, approvals: approvals.approvals ?? [], prepared, accounts: accounts.accounts ?? [], name }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const { account, shows } = useAccount(client)
  useEffect(() => {
    if (data) void syncWidget(client, data)
  }, [client, data])
  const waiting = data ? data.approvals.filter((a) => a.status === 'pending').length + data.prepared.length : 0
  useEffect(() => {
    if (data) setWaiting(waiting)
  }, [data, waiting])

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <HomeHeader name={data?.name ?? null} account={account} />
      <KeyRecoveryCard />
      {data && shows ? (
        <HomeView data={data} account={account} shows={shows} name={data.name} peg={peg} onDecided={reload} />
      ) : error && !loading ? (
        <HomeError onRetry={reload} />
      ) : (
        <HomeLoading />
      )}
    </Screen>
  )
}
