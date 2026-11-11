// Jest: the phone's notification centre, which jest-expo does not stand in for. No notification has been tapped and
// notifications are not allowed, so nothing registers; src/__tests__/push.test.tsx replaces it to tap one.
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT'
export const setNotificationHandler = () => undefined
export const requestPermissionsAsync = async () => ({ granted: false })
export const getDevicePushTokenAsync = async () => ({ type: 'ios', data: '' })
export const useLastNotificationResponse = () => null
export const setNotificationCategoryAsync = async () => null
const received = new Set<(n: unknown) => void>()
export const addNotificationReceivedListener = (l: (n: unknown) => void) => (received.add(l), { remove: () => void received.delete(l) })
/** Jest only: a push arriving while the app is open, with its data. */
export const __receive = (data: Record<string, unknown>) => received.forEach((l) => l({ request: { content: { data } } }))
