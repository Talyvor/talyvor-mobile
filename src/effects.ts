// B61.130 — the phone's special openings and transitions (pocket-live DESIGN.md section 15). A screen says what happened
// once the server has answered, beside its sound; the background and the effects layer draw it. An effect never carries
// meaning alone (the words, a tick or a figure say the same) and nothing is drawn with Reduce Motion on: each drawing
// checks the setting itself, so a screen only says what happened.

/** How money moved: sent and withdrawn ring in the page's colour; approved and added ring green; inside the account
 * (to an agent, back from one, a conversion) is the pulse only. */
export type MoneyMove = 'sent' | 'approved' | 'in' | 'inside'

export type Effect =
  /** one bright pulse along the streams into their point */
  | { kind: 'pulse' }
  /** a soft ring of colour opening across the screen */
  | { kind: 'ring'; tone: 'good' | 'hue' }
  /** 44 dots and dashes from the middle of the screen: an account opened, an agent made */
  | { kind: 'burst' }
  /** the app opened after the passcode: the streams draw in and Home's figures count up */
  | { kind: 'opening' }
  /** every agent was paused just now, before the screen under the sheet has read it again */
  | { kind: 'paused' }

const listeners = new Set<(e: Effect) => void>()
let openedAt = 0

/** For the background and the effects layer: what happened, as it happens. */
export function onEffect(listener: (e: Effect) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function say(e: Effect) {
  if (e.kind === 'opening') openedAt = Date.now()
  for (const l of [...listeners]) l(e)
}

/** Money moved, after the server's answer: the pulse, and the ring unless it moved inside the account. */
export function moneyMoved(how: MoneyMove): void {
  say({ kind: 'pulse' })
  if (how !== 'inside') say({ kind: 'ring', tone: how === 'approved' || how === 'in' ? 'good' : 'hue' })
}

/** An account opened, or an agent made. Only these two moments in the whole app. */
export function celebrate(): void {
  say({ kind: 'burst' })
}

/** Every agent was paused: the streams under the sheet stop and turn grey without waiting for Home to read again. */
export function everyAgentPaused(): void {
  say({ kind: 'paused' })
}

/** The app opened after the passcode or Face ID. */
export function opened(): void {
  say({ kind: 'opening' })
}

/** How long after the app opened a screen that arrives still draws the opening: Home reads its figures first. */
export const OPENING_WINDOW = 3000

/** Whether the app opened just now, so a screen arriving draws the opening. */
export function openingNow(): boolean {
  return openedAt > 0 && Date.now() - openedAt < OPENING_WINDOW
}

/** For tests: forget the opening and every listener. */
export function forgetEffects() {
  openedAt = 0
  listeners.clear()
}
