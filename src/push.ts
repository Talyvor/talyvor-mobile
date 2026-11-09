import { BffError, formatULXC, refusalText, type BffClient } from '@talyvor/bff-client'
import * as Notifications from 'expo-notifications'
import { router, type Href } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Alert } from 'react-native'

import { approveBatch, batchOf } from './approve-batch'
import { biometricName, phoneKey, signWithThisPhone } from './keys'
import { syncLiveActivities } from './live-activity'

// B40.14 — Lens (B40.15) pushes every held payment and every request prepared for approval to the APNs or FCM token of
// each phone whose approval key is on, with the payee and the amount; tapping one opens its approval card. The data is
// Lens's nativepush.Message.Data.

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})

/** The screen a notification's data opens, or null for one that is not an approval. */
export function approvalHref(data: Record<string, unknown> | undefined): Href | null {
  if (data?.type === 'payment_request' && typeof data.request_id === 'string') return { pathname: '/approve/[id]', params: { id: data.request_id } }
  if (data?.type === 'agent_approval' && typeof data.approval_id === 'string') return { pathname: '/approvals/[id]', params: { id: data.approval_id } }
  return null
}

/** B53.9 — a spending notice (Lens B53.7) opens the payment it is about; its push names only the notice. */
export function spendHref(data: Record<string, unknown> | undefined): Href | null {
  if (data?.type !== 'spend_notice') return null
  if ((data.kind === 'payment' || data.kind === 'unusual') && typeof data.notice_id === 'string') return { pathname: '/notices/[id]', params: { id: data.notice_id } }
  return '/spending'
}

// B41.34 — a request's notification carries an Approve button, on the lock screen too. It opens the app, where Face ID
// or a fingerprint unlocks the device key that signs the batch hash: the SHA-256 of Lens's statement for exactly the
// items the notification names (its data's `items`). One that names none opens the card instead.
export const APPROVE_ACTION = 'approve'

/** A notification's data. On iOS expo-notifications reads a remote push's data only from a `body` key, and Lens's APNs
 * push puts its data at the top of the payload, so there it is the trigger's raw payload. */
export function pushData(request: Notifications.NotificationRequest): Record<string, unknown> | undefined {
  const { data } = request.content
  if (data && Object.keys(data).length > 0) return data
  return request.trigger && 'payload' in request.trigger ? (request.trigger.payload ?? undefined) : undefined
}

/** B55.47 — an agent's approval from its notification's Approve button. Lens's challenge binds only the approval's id,
 * so the key signs only when the approval Lens holds is the one the notification named: its agent, payee and µLXC. */
export async function approveAgentApproval(client: BffClient, data: Record<string, unknown>): Promise<void> {
  const a = ((await client.approvals()).approvals ?? []).find((x) => x.id === data.approval_id)
  const same = a && a.agent_id === data.agent_id && (a.payee?.name ?? '') === String(data.payee_name ?? '') &&
    data.currency === 'LXC' && String(a.amount_ulxc) === String(data.amount_minor)
  if (!a || !same) throw new Error('what you were asked to sign is not what was shown, so nothing was signed')
  const agentName = String(data.agent_name || a.agent_id)
  await client.approve(a.id, await signWithThisPhone(client, (await client.approvalChallenge(a.id)).challenge, `Approve ${formatULXC(a.amount_ulxc)} for ${agentName}`))
}

/** Gives Lens this phone's push token, once its approval key is on and the person allows notifications. */
export async function registerPush(client: BffClient): Promise<void> {
  // Lens takes a push token only for a key this workspace holds.
  const key = await phoneKey(client)
  if (!key?.here || !(await Notifications.requestPermissionsAsync()).granted) return
  const approve = [{ identifier: APPROVE_ACTION, buttonTitle: `Approve with ${biometricName}`, options: { opensAppToForeground: true } }]
  await Notifications.setNotificationCategoryAsync('payment_request', approve)
  await Notifications.setNotificationCategoryAsync('agent_approval', approve)
  const { data } = await Notifications.getDevicePushTokenAsync()
  await client.setPushToken(key.id, String(data))
}

/** While signed in: keeps the push token current and opens the approval a tapped notification names. */
export function usePushApprovals(client: BffClient, signedIn: boolean) {
  const response = Notifications.useLastNotificationResponse()
  useEffect(() => {
    // Without push the Approvals tab still lists everything waiting, so a phone that cannot register is not stopped.
    if (signedIn) registerPush(client).catch((err) => console.warn('push: not registered', err))
  }, [client, signedIn])
  const approved = useRef<unknown>(null)
  useEffect(() => {
    if (!signedIn || !response || approved.current === response) return
    const data = pushData(response.notification.request)
    const href = approvalHref(data)
    const spend = spendHref(data)
    const batch = batchOf(data?.items)
    if (response.actionIdentifier === APPROVE_ACTION && data && href && ((data.type === 'payment_request' && batch) || data.type === 'agent_approval')) {
      approved.current = response
      const approving = data.type === 'agent_approval' ? approveAgentApproval(client, data) : approveBatch(client, String(data.request_id), batch!)
      approving
        .then(() => syncLiveActivities(client))
        .catch((err: Error) => Alert.alert('Nothing was approved', err instanceof BffError ? refusalText(err) : err.message))
        .finally(() => router.push(href))
    } else if (spend && response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      approved.current = response
      router.push(spend)
    } else if (href && (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER || response.actionIdentifier === APPROVE_ACTION)) router.push(href)
  }, [client, response, signedIn])
}
