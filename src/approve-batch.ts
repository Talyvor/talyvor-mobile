import { BffError, formatMinor, refusalText, type ApprovalStatement, type BffClient, type PaymentRequest } from '@talyvor/bff-client'

import { signStatement } from './keys'

// The one way a batch of a payment request is approved on this phone, from its card or from its notification's Approve
// button (B41.34): Lens writes the statement for exactly the items shown, the screen checks it, and Face ID or a
// fingerprint unlocks the device key that signs its SHA-256.

export type BatchItem = NonNullable<ApprovalStatement['items']>[number] & { payee_name?: string }

/** Totals by currency, as one line, dollars first (B57.93). */
export const totalsOf = (items: Pick<BatchItem, 'currency' | 'amount_minor'>[]) =>
  Object.entries(items.reduce<Record<string, number>>((t, it) => ({ ...t, [it.currency]: (t[it.currency] ?? 0) + it.amount_minor }), {}))
    .sort(([a], [b]) => Number(b === 'USD') - Number(a === 'USD'))
    .map(([cur, minor]) => formatMinor(minor, cur))
    .join(' + ')

export const payWord = (n: number) => (n === 1 ? '1 payment' : `${n} payments`)

/** B57.93 — why an approval did not happen: Nothing was approved, then Lens's sentence where it gave one. */
export function notApproved(err: unknown): string {
  const why = err instanceof BffError ? refusalText(err).replace(/^Nothing changed\. /, '') : String((err as Error)?.message ?? err)
  return `Nothing was approved. ${why.charAt(0).toUpperCase()}${why.slice(1)}${why.endsWith('.') ? '' : '.'}`
}

// A refusal from a notification's Approve button is said on the card the notification then opens, by request id.
const refusedFromNotification = new Map<string, string>()
export const noteRefusal = (requestId: string, text: string) => void refusedFromNotification.set(requestId, text)
/** The refusal the notification left for this card, said once. */
export function takeRefusal(requestId: string): string {
  const text = refusedFromNotification.get(requestId) ?? ''
  refusedFromNotification.delete(requestId)
  return text
}

// B57.105: an agent's approval approved from its notification lands on Pocket's Approved screen, by approval id.
const approvedFromNotification = new Set<string>()
export const noteApproved = (approvalId: string) => void approvedFromNotification.add(approvalId)
/** Whether the notification approved this approval, said once. */
export const takeApproved = (approvalId: string) => approvedFromNotification.delete(approvalId)

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
  // The biometric prompt names every payment it signs: a notification shows a summary, the prompt shows the batch.
  const each = shown.map((it) => `${it.payee_name || it.payee_id} ${formatMinor(it.amount_minor, it.currency)}`).join(', ')
  const assertion = await signStatement(client, prepared.statement, `Approve ${payWord(shown.length)}, ${totalsOf(shown)}: ${each}`)
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
