import { cleanup, fireEvent, render, screen } from '@testing-library/react-native'
import type { ReactElement } from 'react'

// B57.64 — pressEverything for jest, as the web's (talyvor-suite B57.1, apps/web/src/test/pressEverything.ts): render,
// press every button, link and switch, and report each one that does nothing. A press does something when it calls
// back (`said`) or changes what is drawn. Each control is pressed on a FRESH render, so what one press does cannot hide
// what the next does not. A disabled control is not pressed; it passes only when words beside it say why.

export interface PressReport {
  /** how many controls were pressed */
  pressed: number
  /** one line per control that did nothing, or that is disabled without saying why */
  dead: string[]
}

const ROLES = ['button', 'link', 'switch', 'tab', 'menuitem'] as const

function controls() {
  return ROLES.flatMap((role) => screen.queryAllByRole(role))
}

function nameOf(el: ReturnType<typeof controls>[number]): string {
  const label = el.props.accessibilityLabel as string | undefined
  if (label) return label
  const texts: string[] = []
  const walk = (n: unknown) => {
    if (typeof n === 'string') texts.push(n)
    else if (n && typeof n === 'object' && 'children' in n) for (const c of (n as { children: unknown[] }).children ?? []) walk(c)
  }
  walk(el)
  return texts.join(' ').trim() || `a ${el.props.accessibilityRole} with no name`
}

/** Press everything `ui` draws. `ui` is given `said`, for handlers to call when they do their work. */
export async function pressEverything(ui: (said: (what: string) => void) => ReactElement): Promise<PressReport> {
  let calls = 0
  const said = () => void calls++
  await render(ui(said))
  const names = controls().map(nameOf)
  await cleanup()
  const report: PressReport = { pressed: 0, dead: [] }
  for (let i = 0; i < names.length; i++) {
    await render(ui(said))
    const el = controls()[i]
    if (!el || nameOf(el) !== names[i]) {
      report.dead.push(`${names[i]}: not there on a fresh render`)
      await cleanup()
      continue
    }
    if (el.props.accessibilityState?.disabled) {
      if (!el.props.accessibilityHint) report.dead.push(`${names[i]}: disabled without saying why`)
      await cleanup()
      continue
    }
    const before = JSON.stringify(screen.toJSON())
    const sent = calls
    await fireEvent.press(el)
    report.pressed++
    if (calls === sent && JSON.stringify(screen.toJSON()) === before) report.dead.push(`${names[i]}: does nothing`)
    await cleanup()
  }
  return report
}
