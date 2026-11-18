import * as Haptics from 'expo-haptics'
import { useSyncExternalStore } from 'react'
import { AccessibilityInfo, Easing } from 'react-native'

// B61.73 — the motion tokens of the Pocket design (pocket-live DESIGN.md section 4), one set for the phone and the web.
// Durations are in milliseconds.

export const durations = {
  /** a control shrinking under the finger */
  pressIn: 90,
  /** a control springing back */
  pressOut: 420,
  /** colour and background changes */
  fast: 160,
  /** a tab's content fading up 10 px */
  tab: 240,
  /** a page arriving */
  page: 420,
  /** B61.76 — the tab marker sliding to its tab, and the tab's icon popping once */
  marker: 420,
  /** a phone sheet rising from the bottom, and going */
  sheetIn: 460,
  sheetOut: 320,
  /** a money figure changing */
  roll: 700,
  /** loading shapes, repeating */
  shimmer: 1100,
} as const

export const easings = {
  /** things arriving */
  out: Easing.bezier(0.22, 1, 0.36, 1),
  /** things that spring: press release, badges, the tab marker, switches */
  pop: Easing.bezier(0.34, 1.56, 0.64, 1),
  /** things leaving */
  std: Easing.bezier(0.4, 0, 0.2, 1),
  /** a money figure changing: ease out, power 4 */
  roll: Easing.out(Easing.poly(4)),
} as const

/** The phone's spring with the pop's feel, for a control springing back. */
export const spring = { damping: 18, stiffness: 220, mass: 1 } as const

/** How far a control shrinks under the finger. */
export const pressScale = { button: 0.97, row: 0.97, round: 0.9, key: 0.94 } as const
export type PressKind = keyof typeof pressScale

// The phone's Reduce Motion, read once and on change, for every control at once. null until the first read answers,
// so nothing moves before the setting is known.
let reduceMotion: boolean | null = null
let watching: { remove: () => void } | null = null
const listeners = new Set<() => void>()

function setReduceMotion(on: boolean) {
  reduceMotion = on
  for (const l of listeners) l()
}

function watchReduceMotion(onChange: () => void) {
  listeners.add(onChange)
  if (!watching) {
    watching = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion, () => setReduceMotion(false))
  }
  return () => {
    listeners.delete(onChange)
  }
}

/** True while the phone asks for reduced motion, and until its setting is read: then nothing scales or slides. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(watchReduceMotion, () => reduceMotion) ?? true
}

/** For tests: forget the setting, so the next screen reads it again. */
export function forgetReduceMotion() {
  reduceMotion = null
  watching?.remove()
  watching = null
  listeners.clear()
}

/** light: a press and a tab change. success: an approval or a send gone through. warning: a refusal. A decline has none. */
export type HapticKind = 'light' | 'success' | 'warning'

/** A haptic of its kind; a phone without one feels nothing. */
export function haptic(kind: HapticKind): void {
  try {
    const felt =
      kind === 'light'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)
    felt.catch(() => {})
  } catch {
    // no haptics on this phone
  }
}
