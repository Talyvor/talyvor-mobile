import type { AudioPlayer } from 'expo-audio'
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

import { haptic, type HapticKind } from './motion'

// B61.127 — the phone's sounds (design/pocket-live DESIGN.md section 15): fifteen short WAV files on one scale, each marking
// an outcome the screen already shows, played once the server has answered and never in place of the words. One switch in
// Settings › Look and sound turns them off; the phone's silent switch still mutes them. play() never waits and never
// throws, so a sound can never hold up a press.

const FILES = {
  approved: require('../assets/sounds/approved.wav'),
  celebrate: require('../assets/sounds/celebrate.wav'),
  declined: require('../assets/sounds/declined.wav'),
  freeze: require('../assets/sounds/freeze.wav'),
  key: require('../assets/sounds/key.wav'),
  moneyin: require('../assets/sounds/moneyin.wav'),
  moved: require('../assets/sounds/moved.wav'),
  pause: require('../assets/sounds/pause.wav'),
  refused: require('../assets/sounds/refused.wav'),
  request: require('../assets/sounds/request.wav'),
  resume: require('../assets/sounds/resume.wav'),
  sent: require('../assets/sounds/sent.wav'),
  tick: require('../assets/sounds/tick.wav'),
  unfreeze: require('../assets/sounds/unfreeze.wav'),
  unlock: require('../assets/sounds/unlock.wav'),
} as const

export type SoundName = keyof typeof FILES
export const SOUND_NAMES = Object.keys(FILES) as SoundName[]

const SOUNDS_OFF = 'talyvor.sounds.off'

// On by default. null until the phone's setting is read: a sound asked for before then plays, as the default says.
let off: boolean | null = null
const listeners = new Set<() => void>()
let reading: Promise<void> | null = null

function read() {
  reading ??= SecureStore.getItemAsync(SOUNDS_OFF).then(
    (v) => {
      if (off === null) off = v === '1'
      for (const l of listeners) l()
    },
    () => undefined,
  )
  return reading
}

/** Whether sounds are on, as the person last set them. */
export function soundsOn(): boolean {
  void read()
  return off !== true
}

/** Sounds on or off, kept on this phone. Switching them on plays moneyin once, so the person hears what they chose. */
export async function setSoundsOn(on: boolean): Promise<void> {
  off = !on
  for (const l of listeners) l()
  if (on) play('moneyin')
  try {
    await (on ? SecureStore.deleteItemAsync(SOUNDS_OFF) : SecureStore.setItemAsync(SOUNDS_OFF, '1'))
  } catch {
    // kept for this run of the app only
  }
}

export function useSoundsOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      void read()
      return () => listeners.delete(l)
    },
    () => off !== true,
  )
}

// expo-audio is read the first time a sound is asked for: a build without its native module plays nothing, and nothing
// else in the app waits on it.
type Audio = typeof import('expo-audio')
let audio: Audio | null | undefined
function audioModule(): Audio | null {
  if (audio === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- read late, so a build without the module stays silent
      audio = require('expo-audio') as Audio
    } catch {
      audio = null
    }
  }
  return audio
}

// Each player is made once, as the app starts (or the first time its sound is asked for), and kept.
const players = new Map<SoundName, AudioPlayer>()

function player(a: Audio, name: SoundName): AudioPlayer {
  let p = players.get(name)
  if (!p) {
    p = a.createAudioPlayer(FILES[name])
    players.set(name, p)
  }
  return p
}

/** Loads every sound once, as the app opens, so the first one plays without a wait. */
export function loadSounds(): void {
  void read()
  try {
    const a = audioModule()
    if (a) for (const name of SOUND_NAMES) player(a, name)
  } catch {
    // loaded when first asked for
  }
}

/** One sound, at once, unless the person has switched sounds off. The silent switch mutes it (playsInSilentMode off),
 * and it mixes with whatever else is playing. */
export function play(name: SoundName): void {
  if (!soundsOn()) return
  try {
    const a = audioModule()
    if (!a) return
    // Chat's voice turns playsInSilentMode on for itself; every sound asks for the silent switch back.
    const mode = a.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })
    const p = player(a, name)
    void Promise.resolve(mode)
      .catch(() => undefined)
      .then(() => {
        void Promise.resolve(p.seekTo(0)).catch(() => undefined)
        p.play()
      })
      .catch(() => undefined)
  } catch {
    // a phone that cannot play it hears nothing
  }
}

// The haptics of section 5 play with their sounds: success with sent, approved, moneyin and celebrate, warning with
// refused, light with tick, key and moved. The rest have none.
const FELT: Partial<Record<SoundName, HapticKind>> = { sent: 'success', approved: 'success', moneyin: 'success', celebrate: 'success', refused: 'warning', tick: 'light', key: 'light', moved: 'light' }

/** An outcome where no haptic was felt yet: its sound, and its haptic, which is felt with Sounds off too. */
export function outcome(name: SoundName): void {
  play(name)
  const felt = FELT[name]
  if (felt) haptic(felt)
}

/** For tests: forget the setting and the players. */
export function forgetSounds() {
  off = null
  reading = null
  listeners.clear()
  players.clear()
  audio = undefined
}
