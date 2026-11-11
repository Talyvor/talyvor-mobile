import { Link } from 'expo-router'
import { useCallback } from 'react'
import { Pressable, View } from 'react-native'

import { PAY_ON_CHAIN, useAccount } from '@/account'
import { Icon } from '@/components/icon'
import { MoneyLabel, PAY_OUT } from '@/components/money-label'
import { Body, Card, Eyebrow, Headline, LoadState, Row, Screen, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { useTheme } from '@/theme'
import { lastPaid } from '@/widget-sync'

/** Your saved payees, each with its last payment; a tap opens its payment screen. B59.11: a Stablecoin and crypto account
 * has no bank transfers, so it has no payees here, only where its agents' addresses are. */
export default function PayScreen() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [payees, payments] = await Promise.all([client.payees(), client.payments()])
    return { payees: payees.payees ?? [], payments: payments.payments ?? [] }
  }, [client])
  const { data, error, loading, reload } = useLoad(load)
  const { shows } = useAccount(client)

  return (
    <Screen onRefresh={reload} refreshing={loading && !!data}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>Pay</Headline>
        <MoneyLabel capability={PAY_OUT} />
      </View>
      {shows && !shows.bankTransfers ? (
        <Body muted>{PAY_ON_CHAIN}</Body>
      ) : (
        <>
          <Eyebrow>Saved payees</Eyebrow>
          <LoadState loading={(loading && !data) || !shows} error={error} />
        </>
      )}
      {shows?.bankTransfers && data && data.payees.length === 0 ? <Body muted>No payees yet</Body> : null}
      {shows?.bankTransfers && data && data.payees.length > 0 ? (
        <Card white>
          {data.payees.map((p, i) => (
            <Link key={p.id} href={{ pathname: '/payees/[id]', params: { id: p.id } }} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={`Pay ${p.name}`}>
                <Row
                  first={i === 0}
                  left={
                    <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud }}>
                      <Icon name="payments" />
                    </View>
                  }
                  title={p.name}
                  sub={lastPaid(data.payments, p.id)}
                  right={<Icon name="chev" size={16} color={c.ink3} />}
                />
              </Pressable>
            </Link>
          ))}
        </Card>
      ) : null}
      {shows?.bankTransfers && data ? <Body muted>Payees are added in Talyvor on the web.</Body> : null}
    </Screen>
  )
}
