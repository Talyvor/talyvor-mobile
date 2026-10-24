import { formatULXC, type AgentApproval, type AgentBook, type BffClient, type PaymentRequest } from '@talyvor/bff-client'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { payWord, totalsOf } from './approve-batch'
import { biometricName } from './keys'
import { palettes } from './theme'
import ApprovalActivity, { type ApprovalActivityProps } from './widgets/approval-activity'

// B41.36 — every held payment (a request prepared for approval, or an agent's held payment) has a Live Activity on the
// lock screen and in the Dynamic Island while it waits; once it is approved or declined, here or anywhere else, the next
// sync ends it showing which. iOS lets only the open app start one, so a sync runs on sign-in, whenever the app comes
// to the front, when an approval's push arrives while it is open, and after every decision made on this phone.

// Which activity shows which held payment: activities outlive the app process, so this does too.
const SHOWN = 'talyvor.liveactivity.shown'
type Shown = Record<string, { id: string; props: ApprovalActivityProps }>

export interface Held {
  /** `pr:<request id>` or `ap:<approval id>` */
  key: string
  url: string
  props: ApprovalActivityProps
}

/** What is waiting for the owner, as the activities show it. */
export function heldPayments(requests: PaymentRequest[], approvals: AgentApproval[], book: AgentBook): Held[] {
  const nameOf = (id: string) => book.agents?.find((a) => a.id === id)?.name ?? id
  const base = { state: 'waiting' as const, hint: `Tap to approve with ${biometricName}`, palette: palettes }
  return [
    ...requests
      .filter((r) => r.status === 'pending_approval')
      .map((r) => {
        const asked = r.items.filter((it) => it.decision === 'needs_approval')
        return {
          key: `pr:${r.id}`,
          url: `talyvor://approve/${encodeURIComponent(r.id)}`,
          props: {
            ...base,
            title: asked.length === 1 ? asked[0].payee_name : r.summary || payWord(asked.length),
            amount: totalsOf(asked),
            detail: r.agent_id ? `From ${nameOf(r.agent_id)}’s account` : 'From the company’s account',
            // Lens pays approved requests with test money (see app/approve/[id].tsx).
            preview: true,
          },
        }
      }),
    ...approvals
      .filter((a) => a.status === 'pending')
      .map((a) => ({
        key: `ap:${a.id}`,
        url: `talyvor://approvals/${encodeURIComponent(a.id)}`,
        props: { ...base, title: a.payee ? a.payee.name || a.payee.id : `Ask ${a.model}`, amount: formatULXC(a.amount_ulxc), detail: `${nameOf(a.agent_id)} asks`, preview: false },
      })),
  ]
}

/** How a held payment that is no longer waiting was decided, or null when that cannot be read now. */
async function outcome(client: BffClient, key: string, approvals: AgentApproval[]): Promise<'approved' | 'declined' | null> {
  const [kind, id] = [key.slice(0, 3), key.slice(3)]
  const status = kind === 'ap:' ? approvals.find((a) => a.id === id)?.status : (await client.paymentRequest(id).catch(() => null))?.status
  if (!status) return null
  return ['approved', 'used', 'auto'].includes(status) ? 'approved' : 'declined'
}

async function sync(client: BffClient) {
  const [requests, approvals, book] = await Promise.all([
    client.pendingPaymentRequests().then((r) => r.requests ?? []),
    client.approvals().then((r) => r.approvals ?? []),
    client.book(),
  ])
  const live = new Map(ApprovalActivity.getInstances().map((a) => [a.getId(), a]))
  const shown = JSON.parse((await SecureStore.getItemAsync(SHOWN)) ?? '{}') as Shown
  const next: Shown = {}
  for (const h of heldPayments(requests, approvals, book)) {
    // One the person swiped away stays away.
    if (shown[h.key]) next[h.key] = shown[h.key]
    else {
      try {
        next[h.key] = { id: ApprovalActivity.start(h.props, h.url).getId(), props: h.props }
      } catch {
        // Live Activities are off for this app, or it is not in front: the notification and the Approvals tab still show it
      }
    }
  }
  const kept = new Set(Object.values(next).map((s) => s.id))
  for (const [id, activity] of live) {
    if (kept.has(id)) continue
    const key = Object.keys(shown).find((k) => shown[k].id === id)
    const state = key ? await outcome(client, key, approvals) : null
    if (key && !state) next[key] = shown[key] // not readable now: the next sync ends it
    else await activity.end('default', state ? { ...shown[key!].props, state } : undefined)
  }
  await SecureStore.setItemAsync(SHOWN, JSON.stringify(next))
}

let running: Promise<void> = Promise.resolve()

/** Starts an activity for each held payment and ends each one that was decided; runs one at a time, a failure waits for the next. */
export function syncLiveActivities(client: BffClient): Promise<void> {
  running = running.then(() => sync(client)).catch((err) => console.warn('live activity: not synced', err))
  return running
}

/** Signed out, no payment stays on the lock screen. */
export async function endLiveActivities() {
  await running
  await Promise.all(ApprovalActivity.getInstances().map((a) => a.end('immediate')))
  await SecureStore.deleteItemAsync(SHOWN)
}

/** While signed in: syncs on sign-in, whenever the app comes to the front, and when an approval's push arrives. */
export function useLiveActivities(client: BffClient, signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return
    void syncLiveActivities(client)
    const front = AppState.addEventListener('change', (s) => s === 'active' && void syncLiveActivities(client))
    const push = Notifications.addNotificationReceivedListener((n) => {
      const type = n.request.content.data?.type
      if (type === 'payment_request' || type === 'agent_approval') void syncLiveActivities(client)
    })
    return () => {
      front.remove()
      push.remove()
    }
  }, [client, signedIn])
}
