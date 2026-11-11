import type { BffClient } from '@talyvor/bff-client'
import * as Notifications from 'expo-notifications'
import { useEffect, useSyncExternalStore } from 'react'

import { pendingPrepared } from './components/prepared-payment-card'

// B57.65 — how many things wait for the owner: agents' requests and prepared payments, the Approvals tab's badge.
// Home and Approvals publish the count their own load found; an approval's push arriving re-reads it from Lens.

let count = 0
const listeners = new Set<() => void>()

/** Publishes the count a screen's load found. */
export function setWaiting(n: number) {
  if (n === count) return
  count = n
  listeners.forEach((l) => l())
}

/** Agents' requests waiting plus payments prepared for approval, read from Lens. */
export async function countWaiting(client: BffClient): Promise<number> {
  const [approvals, prepared] = await Promise.all([client.approvals(), pendingPrepared(client)])
  return (approvals.approvals ?? []).filter((a) => a.status === 'pending').length + prepared.length
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

/** The count, read once when the tabs open and again whenever an approval's push arrives. */
export function useWaiting(client: BffClient): number {
  useEffect(() => {
    // A failed read keeps the last count: the Approvals tab itself still lists everything, and says why it could not.
    const refresh = () => void countWaiting(client).then(setWaiting, () => undefined)
    refresh()
    const push = Notifications.addNotificationReceivedListener((n) => {
      const type = n.request.content.data?.type
      if (type === 'payment_request' || type === 'agent_approval') refresh()
    })
    return () => push.remove()
  }, [client])
  return useSyncExternalStore(subscribe, () => count)
}
