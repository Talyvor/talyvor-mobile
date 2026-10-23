import type { BffClient } from '@talyvor/bff-client'
import * as Notifications from 'expo-notifications'
import { router, type Href } from 'expo-router'
import { useEffect } from 'react'

import { thisPhoneDevice } from './keys'

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

/** Gives Lens this phone's push token, once its approval key is on and the person allows notifications. */
export async function registerPush(client: BffClient): Promise<void> {
  const device = await thisPhoneDevice()
  if (!device || !(await Notifications.requestPermissionsAsync()).granted) return
  const { data } = await Notifications.getDevicePushTokenAsync()
  await client.setPushToken(device, String(data))
}

/** While signed in: keeps the push token current and opens the approval a tapped notification names. */
export function usePushApprovals(client: BffClient, signedIn: boolean) {
  const response = Notifications.useLastNotificationResponse()
  useEffect(() => {
    // Without push the Approvals tab still lists everything waiting, so a phone that cannot register is not stopped.
    if (signedIn) registerPush(client).catch((err) => console.warn('push: not registered', err))
  }, [client, signedIn])
  useEffect(() => {
    if (!signedIn || response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const href = approvalHref(response.notification.request.content.data)
    if (href) router.push(href)
  }, [response, signedIn])
}
