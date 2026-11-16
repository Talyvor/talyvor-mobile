import type { Agent } from '@talyvor/bff-client'
import { useCallback, useState } from 'react'
import { View } from 'react-native'

import { useAccount } from '@/account'
import { AgentFundingSheet, type FundingDirection } from '@/components/agent-funding'
import { AgentRow } from '@/components/home'
import { Back, Body, Button, Card, Eyebrow, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import { WalletButtons, WalletSheet, type WalletAction } from '@/components/wallet-actions'
import { walletSides, WalletSide } from '@/components/wallets'
import { keysAvailable, phoneKey } from '@/keys'
import { useSession } from '@/session'

/** Wallets (B59.33), from Home's total: each side of money the account's kind has, and what each account holds in it;
 * Top up, Withdraw and, for Hybrid, Convert. B61.85: then Your agents, each with Add money and Take back, as Pocket Live's
 * Balances draws them. */
export default function WalletsScreen() {
  const { client } = useSession()
  const load = useCallback(async () => {
    const [accounts, key, book] = await Promise.all([client.moneyAccounts(), phoneKey(client).catch(() => null), client.book()])
    return { accounts: accounts.accounts ?? [], hasKey: !!key?.here && keysAvailable(), agents: (book.agents ?? []).filter((a) => !a.archived_at) }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const { shows } = useAccount(client)
  const [action, setAction] = useState<WalletAction | null>(null)
  const [funding, setFunding] = useState<{ agent: Agent; direction: FundingDirection } | null>(null)
  const [moved, setMoved] = useState('')

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
          {data.agents.length ? (
            <View style={{ gap: 12 }} testID="wallets-agents">
              <Eyebrow>{shows.agents}</Eyebrow>
              {moved ? <Body>{moved}</Body> : null}
              <Card white>
                {data.agents.map((g, i) => (
                  <View key={g.id}>
                    <AgentRow agent={g} accounts={data.accounts} shows={shows} waiting={false} first={i === 0} />
                    <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
                      <Button small variant="secondary" icon="plus" label="Add money" accessibilityLabel={`Add money to ${g.name}`} onPress={() => setFunding({ agent: g, direction: 'to_agent' })} />
                      <Button small variant="secondary" icon="download" label="Take back" accessibilityLabel={`Take back from ${g.name}`} onPress={() => setFunding({ agent: g, direction: 'to_company' })} />
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          ) : null}
          {funding ? (
            <AgentFundingSheet
              agent={funding.agent}
              direction={funding.direction}
              onClose={() => setFunding(null)}
              onDone={(said) => {
                setMoved(said)
                reload()
              }}
            />
          ) : null}
          <WalletSheet action={action} client={client} shows={shows} accounts={data.accounts} hasKey={data.hasKey} onClose={() => setAction(null)} onDone={reload} />
        </>
      ) : null}
    </Screen>
  )
}
