import type { CardDispute } from '@talyvor/bff-client'

// dispute-words.ts — B59.26: card disputes, refunds and the card export, in the web's words, copied word for word from
// talyvor-suite B59.25 (apps/web/src/areas/lens/CardDisputes.tsx and AccountStatement.tsx at e1edd6e8), so the phone and
// the web say the same thing. A change to one is a change to both: src/__tests__/disputes.test.tsx holds the web's
// strings and checks the phone's screens against them.

export const DISPUTE_WORDS = {
  dispute: 'Dispute this payment',
  why: 'Why are you disputing it?',
  issuerDecides: 'The card issuer decides. If you win, the payment comes back to this account.',
  send: 'Send dispute',
  sending: 'Sending…',
  cancel: 'Cancel',
  whyFirst: 'Say why you are disputing it first.',
  sent: 'Dispute sent to the card issuer',
  opened: 'Dispute opened',
  withIssuer: 'With the card issuer',
  lost: 'Dispute lost',
  title: 'Disputes and refunds',
  refund: 'Refund',
  disputeWon: 'Dispute won',
  cardPayment: 'Card payment',
  aMerchant: 'A merchant',
  from: 'Card payments from',
  to: 'To',
  export: 'Export',
  range: 'Choose a first day on or before the last.',
  readFailed: 'Its disputes and refunds could not be read just now.',
} as const

/** "Dispute won · £30.00 back", with what came back written by the caller. */
export const wonText = (back: string) => `${DISPUTE_WORDS.disputeWon} · ${back} back`

/** What Export says once the file is handed over. */
export const exportedText = (from: string, through: string) => `Downloading card payments from ${from} to ${through} as a CSV file`

/** The file Export writes, as the web names it. */
export const exportName = (from: string, through: string) => `card-payments-${from}-to-${through}.csv`

/** Lens's longest reason, in characters (economy.MaxCardDisputeReason). */
export const MAX_REASON = 500

/** Where a dispute stands, as its chip says it, and the chip's tone. `back` writes what came back of a won one. */
export function disputeState(d: CardDispute, back: (minor: number, currency: string) => string): { text: string; tone: 'good' | 'bad' | 'wait' } {
  switch (d.status) {
    case 'won':
      return { text: wonText(back(d.credited_minor, d.currency)), tone: 'good' }
    case 'lost':
      return { text: DISPUTE_WORDS.lost, tone: 'bad' }
    case 'with_issuer':
      return { text: DISPUTE_WORDS.withIssuer, tone: 'wait' }
    default:
      return { text: DISPUTE_WORDS.opened, tone: 'wait' }
  }
}

/** A day typed as YYYY-MM-DD that is a real day. */
export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s)
