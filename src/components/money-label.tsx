import { labelOf, workspaceLabels, type AgentApproval, type BffClient, type PaymentRequest } from '@talyvor/bff-client'
import { useEffect, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import Svg, { Circle, Rect } from 'react-native-svg'

import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { Eyebrow } from './ui'

// B56.12 — LABELS ON THE PHONE (Nick, 1 Nov 2026: "yes to labels. but make sure they are true to what they state").
//
// A money screen says Live or Sandbox as Lens answers it: signed in, each capability's label for THIS workspace from
// /api/wallets/capabilities (talyvor-lens B56.7: sandbox while its plan has no live money, while it is synthetic, or
// while a rail is in test); signed out, Lens's public answer from /api/pricing. Until Lens answers, or for a capability
// it gave no label, nothing is drawn; a read that failed says Status unknown, so the label never vanishes for a reason
// the owner cannot see (B57.119, the launch pack's S-06, as the web's top bar says it). The phone draws no Building
// label: it names no feature that is not shipped. The lock-screen Live Activity and the widget carry no label.

/** What each label means, in one plain line: the web's StatusLabel lines (suite B56.9). */
const LINES = { live: 'Moves real money.', sandbox: 'Works. No real money moves.' } as const
const WORDS = { live: 'Live', sandbox: 'Sandbox' } as const
/** A read that failed: the web's top-bar words (suite B57.118). */
const UNKNOWN = 'Status unknown'
const UNKNOWN_LINE = 'Talyvor could not read whether this workspace moves real money.'

/** Credit the workspace hands its agents: Home's safe-to-spend, the statement and an agent's balance (the web's AGENT_CREDIT). */
export const AGENT_CREDIT = ['spend_on_talyvor', 'move_between_own_agents'] as const

/** Money paid out to a saved payee outside Talyvor. */
export const PAY_OUT = ['payments_out'] as const

/** The capability an agent's approval moves money on: a model call is spending on Talyvor; a payment is by its payee. */
export function approvalCapability(a: AgentApproval, ownAgents: readonly { id: string }[]): string {
  if (a.kind === 'card_challenge') return 'agent_card'
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
  return useMoneyRead().labels
}

/** Lens's labels, and whether the last read for this session failed. */
function useMoneyRead(): { labels?: Record<string, string>; failed?: boolean } {
  const { client, signedIn } = useSession()
  // Kept with the session it was read for: a new session's screens draw nothing until Lens answers for it.
  const [answer, setAnswer] = useState<{ client: BffClient; labels?: Record<string, string>; failed?: boolean } | null>(null)
  useEffect(() => {
    let live = true
    labelsFor(client, signedIn).then(
      (labels) => live && setAnswer({ client, labels }),
      () => live && setAnswer({ client, failed: true }),
    )
    return () => {
      live = false
    }
  }, [client, signedIn])
  return answer?.client === client ? answer : {}
}

// B57.119 — drawn as pocket.css .status: a 24-high pill on the page colour, its 1.5px edge in success for Live and in
// the control edge for Sandbox, the word at 12 in the UI face, and the reference's own 12-unit mark before it.
function Mark({ state, color }: { state: 'live' | 'sandbox'; color: string }) {
  return (
    <Svg testID={`money-label-mark-${state}`} width={12} height={12} viewBox="0 0 12 12">
      {state === 'live' ? (
        <>
          <Circle cx="6" cy="6" r="2.1" fill={color} />
          <Circle cx="6" cy="6" r="4.6" fill="none" stroke={color} strokeWidth={1.4} />
        </>
      ) : (
        <Rect x="1.6" y="1.6" width="8.8" height="8.8" rx="2" fill="none" stroke={color} strokeWidth={1.6} strokeDasharray="2.2 1.8" />
      )}
    </Svg>
  )
}

/** The one chip: Live only when Lens says live for every capability given, else Sandbox, else nothing; Status unknown
 * when the read failed. */
export function MoneyLabel({ capability }: { capability: string | readonly string[] }) {
  const { c } = useTheme()
  const { labels, failed } = useMoneyRead()
  const state = labelOf(labels, typeof capability === 'string' ? [capability] : capability)
  if (!state && !failed) return null
  const tone = state === 'live' ? c.success : c.ink2
  return (
    <View
      accessible
      accessibilityLabel={state ? WORDS[state] : UNKNOWN}
      accessibilityHint={state ? LINES[state] : UNKNOWN_LINE}
      testID={state ? `money-label-${state}` : 'money-label-unknown'}
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 24,
        paddingLeft: state ? 8 : 10,
        paddingRight: state ? 9 : 10,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: state === 'live' ? c.success : c.control,
        backgroundColor: c.page,
      }}>
      {state ? <Mark state={state} color={tone} /> : null}
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.12, color: tone }}>{state ? WORDS[state] : UNKNOWN}</Text>
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
