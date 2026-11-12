import { BffError, formatMinor, type BffClient, type PaymentRequest } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { Text, View } from 'react-native'

import { onDay } from '../activity'
import { fonts, useTheme } from '../theme'
import { Icon } from './icon'
import { MoneyLabel, paymentRequestCapabilities } from './money-label'
import { Body, Button, Card } from './ui'

// B55.11 — a payment Chat, an assistant or an agent prepared, listed on Home and Approvals above the agents' requests;
// it opens its approval card, where it is approved or declined. B57.68: drawn as Pocket's p-approvals row, with Review.

/** Who prepared it: Lens names the client "chat", "voice", "mcp:<client id>" or "key:<key id>" (B40.3). */
export const preparedBy = (client: string) =>
  client.startsWith('mcp:') ? 'Your assistant' : client.startsWith('key:') ? 'An agent' : client === 'voice' ? 'A voice request' : 'Chat'

/** The requests waiting for approval; a BFF that cannot list them yet lists none. */
export async function pendingPrepared(client: BffClient): Promise<PaymentRequest[]> {
  try {
    return ((await client.pendingPaymentRequests()).requests ?? []).filter((r) => r.status === 'pending_approval')
  } catch (err) {
    if (err instanceof BffError && (err.status === 404 || err.status === 405)) return []
    throw err
  }
}

export function PreparedPaymentCard({ request: r, label = true }: { request: PaymentRequest; label?: boolean }) {
  const { c } = useTheme()
  const who = preparedBy(r.client)
  const what = r.items.length === 1 ? `${who} prepared a payment to ${r.items[0].payee_name || r.items[0].listing_id}` : `${who} prepared ${r.items.length} payments`
  const reference = r.items.map((it) => it.reference).filter(Boolean).join(', ')
  const total = Object.entries(r.totals)
    .map(([cur, minor]) => formatMinor(minor, cur))
    .join(' + ')
  return (
    <Card white>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud }}>
          <Icon name="chat" color={c.ink} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Body style={{ fontFamily: fonts.uiMedium }}>{what}</Body>
          <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink3, fontVariant: ['tabular-nums'] }}>
            {[reference, `asked ${onDay(r.created_at)}`, total].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Button primary small label="Review" accessibilityLabel={`Review: ${what}`} onPress={() => router.push({ pathname: '/approve/[id]', params: { id: r.id } })} />
      </View>
      {label ? <MoneyLabel capability={paymentRequestCapabilities([r])} /> : null}
    </Card>
  )
}
