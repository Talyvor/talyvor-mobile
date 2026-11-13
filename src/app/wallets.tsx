import { useCallback } from 'react'

import { useAccount } from '@/account'
import { Back, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { walletSides, WalletSide } from '@/components/wallets'
import { useSession } from '@/session'

/** Wallets (B59.33), from Home's total: each side of money the account's kind has, and what each account holds in it. */
export default function WalletsScreen() {
  const { client } = useSession()
  const load = useCallback(async () => (await client.moneyAccounts()).accounts ?? [], [client])
  const { data, error, loading, reload } = useLoad(load)
  const { shows } = useAccount(client)

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/" />
      <Headline>Wallets</Headline>
      <LoadState loading={(loading && !data) || !shows} error={error} />
      {data && shows ? walletSides(data, shows).map((s) => <WalletSide key={s.side} {...s} owner={shows.owner} />) : null}
    </Screen>
  )
}
