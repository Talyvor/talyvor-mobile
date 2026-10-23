// Jest: the phone's notification centre, which jest-expo does not stand in for. No notification has been tapped and
// notifications are not allowed, so nothing registers; src/__tests__/push.test.tsx replaces it to tap one.
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT'
export const setNotificationHandler = () => undefined
export const requestPermissionsAsync = async () => ({ granted: false })
export const getDevicePushTokenAsync = async () => ({ type: 'ios', data: '' })
export const useLastNotificationResponse = () => null
