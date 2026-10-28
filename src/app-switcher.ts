import * as ScreenCapture from 'expo-screen-capture'
import { useEffect } from 'react'
import { Platform } from 'react-native'

// B50.10 — while signed in, every screen shows money, so none of it may show in the app switcher. Android: FLAG_SECURE
// blanks the recent-apps preview (and screenshots); iOS: a full blur covers the app whenever it is not in front.

const KEY = 'signed-in'

export function useHideFromAppSwitcher(on: boolean) {
  useEffect(() => {
    if (!on || Platform.OS === 'web') return
    const failed = (err: unknown) => console.warn('app switcher: not hidden', err)
    ScreenCapture.preventScreenCaptureAsync(KEY).catch(failed)
    if (Platform.OS === 'ios') ScreenCapture.enableAppSwitcherProtectionAsync(1).catch(failed)
    return () => {
      ScreenCapture.allowScreenCaptureAsync(KEY).catch(failed)
      if (Platform.OS === 'ios') ScreenCapture.disableAppSwitcherProtectionAsync().catch(failed)
    }
  }, [on])
}
