import { formatMinor, type ApprovalStatement, type BffClient, type PaymentRequest } from '@talyvor/bff-client'

import { signStatement } from './keys'

// The one way a batch of a payment request is approved on this phone, from its card or from its notification's Approve
// button (B41.34): Lens writes the statement for exactly the items shown, the screen checks it, and Face ID or a
// fingerprint unlocks the device key that signs its SHA-256.

export type BatchItem = NonNullable<ApprovalStatement['items']>[number]

/** Totals by currency, as one line. */
export const totalsOf = (items: Pick<BatchItem, 'currency' | 'amount_minor'>[]) =>
  Object.entries(items.reduce<Record<string, number>>((t, it) => ({ ...t, [it.currency]: (t[it.currency] ?? 0) + it.amount_minor }), {}))
    .map(([cur, minor]) => formatMinor(minor, cur))
    .join(' + ')

export const payWord = (n: number) => (n === 1 ? '1 payment' : `${n} payments`)

/** The statement Lens wrote is what the key signs: refuse to sign one that is not exactly the items shown. */
function sameAsShown(statement: string, shown: BatchItem[]): boolean {
  const s = JSON.parse(statement) as ApprovalStatement
  const key = (x: BatchItem) => [x.position, x.payee_id, x.currency, x.amount_minor, x.reference].join('\u0000')
  const want = shown.map(key).sort()
  const got = (s.items ?? []).map(key).sort()
  return want.length === got.length && want.every((k, i) => k === got[i])
}

export async function approveBatch(client: BffClient, requestId: string, shown: BatchItem[]): Promise<PaymentRequest> {
  const prepared = await client.requestApproval(requestId, shown.map((it) => it.position))
  if (!sameAsShown(prepared.statement, shown)) throw new Error('what you were asked to sign is not what was shown, so nothing was signed')
  const assertion = await signStatement(prepared.statement, `Approve ${payWord(shown.length)}, ${totalsOf(shown)}`)
  return client.approveRequest(requestId, prepared.statement, assertion)
}

/** The items a request's notification shows (Lens puts them in its data as JSON), or null when it carries none. */
export function batchOf(json: unknown): BatchItem[] | null {
  try {
    const items = JSON.parse(String(json)) as unknown
    const ok = (x: Record<string, unknown>) =>
      Number.isInteger(x?.position) && typeof x.payee_id === 'string' && typeof x.currency === 'string' && Number.isInteger(x.amount_minor) && typeof x.reference === 'string'
    return Array.isArray(items) && items.length > 0 && items.every(ok) ? items : null
  } catch {
    return null
  }
}
