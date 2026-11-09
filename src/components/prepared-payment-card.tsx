import { BffError, formatMinor, type BffClient, type PaymentRequest } from '@talyvor/bff-client'
import { Link } from 'expo-router'
import { Pressable, View } from 'react-native'

import { Body, Card, Figure } from './ui'

// B55.11 — a payment Chat, an assistant or an agent prepared, listed on Home and Approvals above the agents' requests;
// it opens its approval card, where it is approved or declined.

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

const asked = (at: string) => {
  const d = new Date(at)
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString()
}

export function PreparedPaymentCard({ request: r }: { request: PaymentRequest }) {
  const who = preparedBy(r.client)
  const what = r.items.length === 1 ? `${who} prepared a payment to ${r.items[0].payee_name || r.items[0].listing_id}` : `${who} prepared ${r.items.length} payments`
  const reference = r.items.map((it) => it.reference).filter(Boolean).join(', ')
  return (
    <Link href={{ pathname: '/approve/[id]', params: { id: r.id } }} asChild>
      <Pressable accessibilityRole="link">
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Body style={{ flex: 1 }}>{what}</Body>
            <Figure>
              {Object.entries(r.totals)
                .map(([cur, minor]) => formatMinor(minor, cur))
                .join(' + ')}
            </Figure>
          </View>
          <Body muted>{`${reference ? `${reference} · ` : ''}asked ${asked(r.created_at)}`}</Body>
        </Card>
      </Pressable>
    </Link>
  )
}
