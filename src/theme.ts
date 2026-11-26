import { createContext, useContext } from 'react'
import { useColorScheme } from 'react-native'

// B57.64 — Pocket's tokens (design/pocket/pocket.css, .pk and .pk-dark): light unless the phone is set to dark.
// Roles: tangerine is the brand and "your move", never text; ink is text and primary actions; agent colours are
// identity only; green and red are status, always with words.
const light = {
  page: '#FFFFFF',
  cloud: '#F3F4F6',
  cloud2: '#ECEEF2',
  ink: '#111216',
  ink2: '#4A5061',
  ink3: '#646B7B',
  line: '#E4E6EB',
  control: '#7A8192',
  tangerine: '#FF7A1A',
  tangerineInk: '#A84100',
  tangerine50: '#FFF1E6',
  success: '#0B7A45',
  success50: '#E6F6EE',
  danger: '#C0262D',
  danger50: '#FDECEC',
  primary: '#111216',
  onPrimary: '#FFFFFF',
  scrim: 'rgba(17,18,22,0.42)',
}
const dark: typeof light = {
  page: '#0F1013',
  cloud: '#181A1F',
  cloud2: '#20232A',
  ink: '#F2F3F5',
  ink2: '#A6ACB9',
  ink3: '#8A90A0',
  line: '#2A2E36',
  control: '#6E7482',
  tangerine: '#FF7A1A',
  tangerineInk: '#FF8A33',
  tangerine50: '#3A2414',
  success: '#3DD68C',
  success50: '#12291E',
  danger: '#FF6B6B',
  danger50: '#331717',
  primary: '#F2F3F5',
  onPrimary: '#111216',
  scrim: 'rgba(0,0,0,0.6)',
}

/** Today's screens name their colours by these older roles; each reads its Pocket token until its own B57 item redraws it. */
function withRoles(p: typeof light) {
  return {
    ...p,
    canvas: p.page,
    surface: p.page,
    raised: p.cloud,
    lineStrong: p.control,
    inkMuted: p.ink2,
    label: p.ink3,
    accent: p.primary,
    onAccent: p.onPrimary,
    accentTint: p.cloud2,
    positive: p.success,
    caution: p.tangerineInk,
    critical: p.danger,
  }
}
export type Palette = ReturnType<typeof withRoles> & { card: string; tint: string; hairline: string; frostLine: string }

/** `#RRGGBB` at an opacity, as CSS's color-mix with transparent. */
export function alpha(hex: string, a: number): string {
  const ch = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${a})`
}
/** `a` mixed into `b` by `k`, as CSS's color-mix(in srgb, a k, b). */
function over(a: string, k: number, b: string): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * k + ch(b, i) * (1 - k)).toString(16).padStart(2, '0').toUpperCase()).join('')}`
}

function plain(p: typeof light) {
  return { ...withRoles(p), card: p.cloud, tint: p.cloud2, hairline: 'transparent', frostLine: 'transparent' }
}
export const palettes = { light: plain(light), dark: plain(dark) }

/** B61.126 — what a piece of the screen sits on (design/pocket-live/DESIGN.md section 6.0). On a screen's glass, what was
 * solid grey is frosted: cloud is the page colour at 66% (68% in dark), cloud-2 at 50%, tracks and pressed rows are ink
 * at 9%, and the third ink is one step stronger so small text keeps 4.5 to 1 on colour. A sheet sits over the page:
 * solid enough to read a form, its greys a touch of ink in the page, its cards the page colour at 66%, and it keeps
 * ink-3. */
export type Surface = 'plain' | 'glass' | 'sheet'
export const SurfaceContext = createContext<Surface>('plain')

function onGlass(p: typeof light, isDark: boolean) {
  return {
    ...withRoles(p),
    cloud: alpha(p.page, isDark ? 0.68 : 0.66),
    cloud2: alpha(p.page, 0.5),
    card: alpha(p.page, isDark ? 0.68 : 0.66),
    ink3: isDark ? '#989EAD' : '#586070',
    tint: alpha(p.ink, 0.09),
    hairline: alpha(p.ink, 0.06),
    frostLine: alpha(p.ink, 0.08),
  }
}
function onSheet(p: typeof light) {
  return { ...withRoles(p), cloud: over(p.ink, 0.05, p.page), cloud2: over(p.ink, 0.09, p.page), card: alpha(p.page, 0.66), tint: over(p.ink, 0.09, p.page), hairline: alpha(p.ink, 0.06), frostLine: 'transparent' }
}
export const surfaces = {
  light: { plain: palettes.light, glass: onGlass(light, false), sheet: onSheet(light) },
  dark: { plain: palettes.dark, glass: onGlass(dark, true), sheet: onSheet(dark) },
} as const

/** The agent colours (pocket.css --a-*): a face's fill, never text. */
export const agentColours = {
  cobalt: '#2F5BFF',
  orchid: '#B65CFF',
  sky: '#39C2FF',
  mint: '#16C79A',
  lemon: '#FFD43B',
  rose: '#FF5C8A',
  lime: '#8EDC4E',
} as const

// Bricolage Grotesque for headlines and money, Figtree for everything else; figures are tabular in both.
export const fonts = {
  ui: 'Figtree_400Regular',
  uiMedium: 'Figtree_600SemiBold',
  uiBold: 'Figtree_700Bold',
  uiHeavy: 'Figtree_800ExtraBold',
  display: 'BricolageGrotesque_700Bold',
  displayBold: 'BricolageGrotesque_800ExtraBold',
}

export function useTheme(): { c: Palette; dark: boolean } {
  const isDark = useColorScheme() === 'dark'
  const surface = useContext(SurfaceContext)
  return { c: surfaces[isDark ? 'dark' : 'light'][surface], dark: isDark }
}
