import { formatMinor, type PaymentRequest } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { View } from 'react-native'

import { useTheme } from '../theme'
import { Icon } from './icon'
import { preparedBy } from './prepared-payment-card'
import { Card, Row } from './ui'

// B57.78 — Bills due's rows as Pocket's p-bills draws them: `Northwind Data · $180.00` over `Invoice 1042 · prepared by
// Chat · waits for you`, each opening its approval card.

const payWord = (n: number) => (n === 1 ? '1 payment' : `${n} payments`)

/** `Chat`, `your assistant`, `an agent`: who prepared it, inside a sentence. */
const byWords = (client: string) => {
  const who = preparedBy(client)
  return who === 'Chat' ? who : who[0].toLowerCase() + who.slice(1)
}

export function BillRows({ requests }: { requests: PaymentRequest[] }) {
  const { c } = useTheme()
  return (
    <Card white>
      <View>
        {requests.map((r, i) => {
          const total = Object.entries(r.totals)
            .map(([cur, minor]) => formatMinor(minor, cur))
            .join(' + ')
          const what = r.items.length === 1 ? r.items[0].payee_name || r.summary : r.summary || payWord(r.items.length)
          const reference = r.items.map((it) => it.reference).filter(Boolean).join(', ')
          return (
            <Row
              key={r.id}
              first={i === 0}
              left={
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud }}>
                  <Icon name="payments" />
                </View>
              }
              title={`${what} · ${total}`}
              sub={[reference, `prepared by ${byWords(r.client)}`, 'waits for you'].filter(Boolean).join(' · ')}
              right={<Icon name="chev" size={16} color={c.ink3} />}
              onPress={() => router.push({ pathname: '/approve/[id]', params: { id: r.id } })}
            />
          )
        })}
      </View>
    </Card>
  )
}
