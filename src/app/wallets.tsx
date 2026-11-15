import { useCallback, useState } from 'react'

import { useAccount } from '@/account'
import { Back, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { WalletButtons, WalletSheet, type WalletAction } from '@/components/wallet-actions'
import { walletSides, WalletSide } from '@/components/wallets'
import { keysAvailable, phoneKey } from '@/keys'
import { useSession } from '@/session'

/** Wallets (B59.33), from Home's total: each side of money the account's kind has, and what each account holds in it;
 * Top up, Withdraw and, for Hybrid, Convert. */
export default function WalletsScreen() {
  const { client } = useSession()
  const load = useCallback(async () => {
    const [accounts, key] = await Promise.all([client.moneyAccounts(), phoneKey(client).catch(() => null)])
    return { accounts: accounts.accounts ?? [], hasKey: !!key?.here && keysAvailable() }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const { shows } = useAccount(client)
  const [action, setAction] = useState<WalletAction | null>(null)

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <Back home="/" />
      <Headline>Wallets</Headline>
      <LoadState loading={(loading && !data) || !shows} error={error} />
      {data && shows ? (
        <>
          <WalletButtons shows={shows} onPress={setAction} />
          {walletSides(data.accounts, shows).map((s) => (
            <WalletSide key={s.side} {...s} owner={shows.owner} />
          ))}
          <WalletSheet action={action} client={client} shows={shows} accounts={data.accounts} hasKey={data.hasKey} onClose={() => setAction(null)} onDone={reload} />
        </>
      ) : null}
    </Screen>
  )
}
