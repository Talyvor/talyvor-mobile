import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Appearance } from 'react-native'

// B61.127 — Settings › Look and sound (design/pocket-live DESIGN.md section 15): the app follows the phone's light or dark,
// or keeps to one of them. Kept on this phone; every screen reads it through useColorScheme, so it changes at once.

export type Look = 'phone' | 'light' | 'dark'

const LOOK = 'talyvor.look'
let look: Look = 'phone'
const listeners = new Set<() => void>()

function apply(next: Look) {
  look = next
  try {
    Appearance.setColorScheme(next === 'phone' ? 'unspecified' : next)
  } catch {
    // a phone without the override follows itself
  }
  for (const l of listeners) l()
}

/** Reads the person's choice as the app opens. */
export async function restoreLook(): Promise<void> {
  try {
    const saved = await SecureStore.getItemAsync(LOOK)
    if (saved === 'light' || saved === 'dark') apply(saved)
  } catch {
    // follows the phone
  }
}

export async function setLook(next: Look): Promise<void> {
  apply(next)
  try {
    await (next === 'phone' ? SecureStore.deleteItemAsync(LOOK) : SecureStore.setItemAsync(LOOK, next))
  } catch {
    // kept for this run of the app only
  }
}

export function useLook(): Look {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => look,
  )
}
