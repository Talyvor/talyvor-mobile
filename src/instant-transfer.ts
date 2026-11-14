import { BffError, formatMinor, refusalText, type AgentApproval, type CurrencyAccount, type InstantLeg, type InstantQuote, type InstantTo, type InstantTransfer, type OutsidePayee } from '@talyvor/bff-client'

// B59.20 — Instant transfer on the phone, for a Hybrid account (launch pack 4.1 and 4.5, design P7 to P10): the words and
// the sums the screens draw. They are the web's (talyvor-suite B59.19, apps/web/src/areas/lens/InstantTransfer.tsx and
// InstantTransferReceipt.tsx at bf9f8d3); a change to one is a change to both, and src/__tests__/instant-transfer.test.tsx
// holds the web's strings. Lens decides everything: the account's kind, the agent's rule, screening and the approval.

/** Lens B59.13's three capabilities: converted, moved on chain, then converted or paid out. */
export const INSTANT_TRANSFER = ['fx', 'stablecoins', 'payments_out'] as const

/** "US dollar" for USD: a balance in words. */
export const BALANCE_WORDS: Record<string, string> = { USD: 'US dollar', GBP: 'pound', EUR: 'euro', USDC: 'USDC' }
/** "US dollars" for USD: what a beneficiary gets, in words. */
export const MONEY_WORDS: Record<string, string> = { USD: 'US dollars', GBP: 'pounds', EUR: 'euros', USDC: 'USDC' }

/** What a bank account in a country is paid in. Lens pays GBP, EUR and USD into a bank. */
export const bankCurrency = (country: string) => (country === 'GB' ? 'GBP' : country === 'US' ? 'USD' : 'EUR')

export const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export const CHOICES: { to: InstantTo; title: string; line: string }[] = [
  { to: 'talyvor_account', title: 'A Talyvor account', line: 'Lands in their balance.' },
  { to: 'wallet', title: 'An outside wallet', line: 'We send the stablecoin to the address they give.' },
  { to: 'bank_account', title: 'An outside bank account', line: 'They get fiat in their bank account.' },
]

/** The words of P7 to P10 and the screens' states (design 6), as the web has them. */
export const WORDS = {
  title: 'Instant transfer',
  whoGetsIt: 'Who gets it',
  pickWho: 'Pick who gets it',
  addAmount: 'Add an amount to see your quote.',
  gettingQuote: 'Getting your quote…',
  noQuote: 'We couldn’t get a quote. Nothing was sent.',
  tryAgain: 'Try again',
  expired: 'This quote expired. Nothing was sent.',
  newQuote: 'Get a new quote',
  screened: 'We can’t send to this recipient. Nothing was sent.',
  declined: 'Declined. Nothing was sent.',
  youSend: 'You send',
  rate: 'Rate',
  fee: 'Fee',
  theyGet: 'They get',
  continue: 'Continue',
  faceIdAsks: (biometric: string) => `${biometric} asks before anything is sent.`,
  approvesOnly: 'This approves this payment only.',
  leave: 'You can leave this screen. We’ll tell you when it lands.',
  done: 'Done',
  seeActivity: 'See it in Activity',
  seeReceipt: 'See the receipt',
  receipt: 'Receipt',
  youSent: 'You sent',
  theyGot: 'They got',
  conversions: 'Conversions',
  onChainReference: 'On-chain reference',
  transferId: 'Transfer ID',
  paidFrom: 'Paid from',
  canUse: 'Can use Instant transfer',
  canUseLine: (agent: string) => `Off by default. When it’s on, ${agent} can send Instant transfers inside these rules. Anything outside them waits for your yes.`,
  payRow: 'Arrives in seconds, any day, any hour',
} as const

/** "Arrives in seconds", or "Arrives by 14:20" with the bank rail's real time. */
export function arrivesText(t: { arrives_in_seconds: boolean; arrives_within_seconds?: number }, from: Date = new Date()): string {
  if (t.arrives_in_seconds || !t.arrives_within_seconds) return 'Arrives in seconds'
  const by = new Date(from.getTime() + t.arrives_within_seconds * 1000)
  return `Arrives by ${by.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/** "1 USD = 0.9210 EUR": a rate Lens gives in whole units, to four places. */
export const rateText = (rate: string | number, sell: string, buy: string) => `1 ${sell} = ${Number(rate).toFixed(4)} ${buy}`

/** "Locked for 30 seconds": how long Lens locked the quote for. */
export const lockedFor = (q: Pick<InstantQuote, 'created_at' | 'expires_at'>) => Math.round((new Date(q.expires_at).getTime() - new Date(q.created_at).getTime()) / 1000)

/** The seconds a quote has left, counted from when it arrived on this phone, so a clock that is off does not shorten it. */
export const secondsLeft = (q: Pick<InstantQuote, 'created_at' | 'expires_at'>, arrivedAt: number, now: number = Date.now()) =>
  Math.max(0, Math.ceil((arrivedAt + Math.max(0, lockedFor(q)) * 1000 - now) / 1000))

/** The approval a refusal names: Lens files it and says "Approval apr_… must be approved by the workspace's owner". */
export const approvalNamedIn = (err: unknown) => (err instanceof BffError ? (/approval (apr_[\w-]+)/i.exec(err.sentence)?.[1] ?? null) : null)

/** Whether a pending approval is the one this transfer waits on: the sentence only names it, so before Face ID signs it
 * the phone checks it is pending, and paid from this agent's account at this amount in this currency. */
export const approvalIsFor = (a: AgentApproval | undefined, account: CurrencyAccount, q: Pick<InstantQuote, 'send_minor' | 'send_currency'>) =>
  !!a &&
  a.status === 'pending' &&
  a.agent_id === account.agent_id &&
  a.paid_from?.kind === 'account' &&
  a.paid_from.account_id === account.id &&
  a.paid_from.amount_minor === q.send_minor &&
  a.paid_from.currency === q.send_currency

/** The words a refused send is shown in, picked from its field and code (design 6), never its field's name. */
export function sendRefusal(err: unknown, agent: string, holds: { minor: number; currency: string } | null): string {
  if (err instanceof BffError) {
    if (err.field === 'may_instant_transfer') return `${agent} can’t use Instant transfer. Turn it on in ${agent}’s rules.`
    if (err.code === 'screened') return WORDS.screened
    if (err.status === 409 && /quote/i.test(err.sentence)) return WORDS.expired
    if (err.status === 409 && /holds/i.test(err.sentence) && holds)
      return `${agent}’s ${BALANCE_WORDS[holds.currency] ?? holds.currency} balance holds ${formatMinor(holds.minor, holds.currency)}. Lower the amount or top up.`
  }
  return refusalText(err)
}

/** "Bank account · Germany · gets euros", or a wallet's "Wallet · ending c41e · gets USDC": a saved payee under its name. */
export function payeeLine(p: OutsidePayee): string {
  if (p.address) return `Wallet · ending ${p.address.slice(-4)} · gets USDC`
  return `Bank account · ${countryName(p.country)} · gets ${MONEY_WORDS[bankCurrency(p.country)]}`
}

/** "LF" for Lumen Freight GmbH: the first letters of the first two words. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

// ── Progress and the receipt ──────────────────────────────────────────────────────────────────────────────────────

export const STEPS = ['Sent', 'Converted', 'On its way', 'Received'] as const
export const STATUS_WORDS: Record<InstantTransfer['status'], string> = {
  sent: 'Sent',
  converted: 'Converted',
  on_its_way: 'On its way',
  received: 'Received',
  reversed: 'Didn’t go through',
}
/** How many steps are done at each state: the next one is in progress. On its way is in progress until it lands. */
const DONE_STEPS: Record<Exclude<InstantTransfer['status'], 'reversed'>, number> = { sent: 1, converted: 2, on_its_way: 2, received: 4 }

export type StepState = 'done' | 'current' | 'next' | 'failed'

/** Each of the four steps' state at the transfer's status. A reversed transfer failed at the first: nothing moved. */
export function stepStates(status: InstantTransfer['status']): StepState[] {
  if (status === 'reversed') return ['failed', 'next', 'next', 'next']
  const done = DONE_STEPS[status]
  return STEPS.map((_, i) => (i < done ? 'done' : i === done ? 'current' : 'next'))
}

/** Each step's line under its name: from which balance, what it converts, where it moves, and what they get. */
export const stepLines = (t: InstantTransfer, agent: string) => [
  `From ${agent}’s ${BALANCE_WORDS[t.send_currency] ?? t.send_currency} balance`,
  `${MONEY_WORDS[t.send_currency] ?? t.send_currency} to USDC`,
  `Moving to ${t.beneficiary_name}`,
  `They get ${formatMinor(t.receive_minor, t.receive_currency)}`,
]

export const finished = (t: InstantTransfer | null | undefined) => t?.status === 'received' || t?.status === 'reversed'

/** The reversed transfer's line: the agent has its whole amount back. */
export const reversedText = (t: InstantTransfer, agent: string) =>
  `This transfer didn’t go through. The full ${formatMinor(t.send_minor, t.send_currency)} is back in ${agent}’s ${BALANCE_WORDS[t.send_currency] ?? t.send_currency} balance.`

const unit = (c: string) => (c === 'USDC' ? 1e6 : 100)

/** One conversion of the receipt from its leg: what it sold, what it bought, and the rate between them. */
function conversion(leg: InstantLeg, sell: number): { text: string; rate: string } {
  const rate = leg.buy.minor / unit(leg.buy.currency) / (sell / unit(leg.sell.currency))
  return { text: `${formatMinor(sell, leg.sell.currency)} to ${formatMinor(leg.buy.minor, leg.buy.currency)}`, rate: `Rate ${rateText(rate, leg.sell.currency, leg.buy.currency)}` }
}

/** The receipt's conversions: into the stablecoin (of what was sent less the fee, which comes out first), then out of it. */
export function conversions(t: InstantTransfer): { text: string; rate: string }[] {
  const legs = t.legs ?? []
  const convert = legs.find((l) => l.leg === 'convert')
  const out = legs.find((l) => (l.leg === 'credit' || l.leg === 'payout') && l.sell.currency === 'USDC')
  return [...(convert ? [conversion(convert, convert.sell.minor - t.fee_minor)] : []), ...(out ? [conversion(out, out.sell.minor)] : [])]
}

/** The move leg's reference: the on-chain one. */
export const onChainReference = (t: InstantTransfer) => (t.legs ?? []).find((l) => l.leg === 'move')?.partner_ref ?? ''

/** "Today at 10:42 · arrived in 12 seconds", or "14 November at 10:42 · …" on another day. */
export function receiptWhen(t: Pick<InstantTransfer, 'created_at' | 'updated_at'>, now: Date = new Date()): string {
  const at = new Date(t.created_at)
  const took = Math.max(1, Math.round((new Date(t.updated_at).getTime() - at.getTime()) / 1000))
  const day = at.toDateString() === now.toDateString() ? 'Today' : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
  return `${day} at ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · arrived in ${took} ${took === 1 ? 'second' : 'seconds'}`
}
