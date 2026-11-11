import { labelOf, workspaceLabels, type AgentApproval, type BffClient, type PaymentRequest } from '@talyvor/bff-client'
import { useEffect, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'

import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { Eyebrow } from './ui'

// B56.12 — LABELS ON THE PHONE (Nick, 1 Nov 2026: "yes to labels. but make sure they are true to what they state").
//
// A money screen says Live or Sandbox as Lens answers it: signed in, each capability's label for THIS workspace from
// /api/wallets/capabilities (talyvor-lens B56.7: sandbox while its plan has no live money, while it is synthetic, or
// while a rail is in test); signed out, Lens's public answer from /api/pricing. Until Lens answers, or for a capability
// it gave no label, nothing is drawn. The phone draws no Building label: it names no feature that is not shipped. The
// lock-screen Live Activity and the widget carry no label.

/** What each label means, in one plain line: the web's StatusLabel lines (suite B56.9). */
const LINES = { live: 'Moves real money.', sandbox: 'Works. No real money moves.' } as const
const WORDS = { live: 'Live', sandbox: 'Sandbox' } as const

/** Credit the workspace hands its agents: Home's safe-to-spend, the statement and an agent's balance (the web's AGENT_CREDIT). */
export const AGENT_CREDIT = ['spend_on_talyvor', 'move_between_own_agents'] as const

/** Money paid out to a saved payee outside Talyvor. */
export const PAY_OUT = ['payments_out'] as const

/** The capability an agent's approval moves money on: a model call is spending on Talyvor; a payment is by its payee. */
export function approvalCapability(a: AgentApproval, ownAgents: readonly { id: string }[]): string {
  switch (a.payee?.kind) {
    case undefined:
      return 'spend_on_talyvor'
    case 'listing':
      return 'buy_marketplace_listings'
    case 'outside':
      return 'payments_out'
    case 'agent':
      return ownAgents.some((x) => x.id === a.payee!.id) ? 'move_between_own_agents' : 'pay_another_owner'
    default:
      return 'pay_another_owner'
  }
}

/** The capabilities prepared payments move money on: a listing's use is bought on Talyvor; every other line is paid out. */
export function paymentRequestCapabilities(requests: readonly PaymentRequest[]): string[] {
  return [...new Set(requests.flatMap((r) => (r.items ?? []).map((it) => (it.listing_id ? 'buy_marketplace_listings' : 'payments_out'))))]
}

/** How long one answer labels every screen; the web's BFF caches the same answer no longer. */
const FRESH_MS = 60_000
let read: { client: BffClient; at: number; labels: Promise<Record<string, string> | undefined> } | null = null

function labelsFor(client: BffClient, signedIn: boolean) {
  if (read?.client === client && Date.now() - read.at < FRESH_MS) return read.labels
  const labels = signedIn ? client.capabilities().then((r) => workspaceLabels(r.capabilities)) : client.pricingLabels()
  const entry = { client, at: Date.now(), labels }
  read = entry
  // A read that failed is asked again by the next screen, never kept.
  labels.catch(() => read === entry && (read = null))
  return labels
}

/** Lens's label for each money capability, by key; undefined until it answers. */
export function useMoneyLabels(): Record<string, string> | undefined {
  const { client, signedIn } = useSession()
  // Kept with the session it was read for: a new session's screens draw nothing until Lens answers for it.
  const [answer, setAnswer] = useState<{ client: BffClient; labels: Record<string, string> | undefined } | null>(null)
  useEffect(() => {
    let live = true
    labelsFor(client, signedIn).then(
      (labels) => live && setAnswer({ client, labels }),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [client, signedIn])
  return answer?.client === client ? answer.labels : undefined
}

/** The one chip: Live only when Lens says live for every capability given, else Sandbox, else nothing. */
export function MoneyLabel({ capability }: { capability: string | readonly string[] }) {
  const { c } = useTheme()
  const state = labelOf(useMoneyLabels(), typeof capability === 'string' ? [capability] : capability)
  if (!state) return null
  const tone = state === 'live' ? c.positive : c.inkMuted
  return (
    <View
      accessible
      accessibilityLabel={`${WORDS[state]}. ${LINES[state]}`}
      testID={`money-label-${state}`}
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 24,
        paddingLeft: 8,
        paddingRight: 9,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: state === 'live' ? c.positive : c.lineStrong,
        backgroundColor: c.canvas,
      }}>
      {state === 'live' ? (
        <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1.4, borderColor: tone, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: tone }} />
        </View>
      ) : (
        <View style={{ width: 10, height: 10, borderRadius: 2, borderWidth: 1.5, borderStyle: 'dashed', borderColor: tone }} />
      )}
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: state === 'live' ? c.positive : c.ink }}>{WORDS[state]}</Text>
    </View>
  )
}

/** A money section's eyebrow with its label at the end of the row. */
export function MoneyHeader({ children, capability }: { children: ReactNode; capability: string | readonly string[] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
      <Eyebrow>{children}</Eyebrow>
      <MoneyLabel capability={capability} />
    </View>
  )
}
