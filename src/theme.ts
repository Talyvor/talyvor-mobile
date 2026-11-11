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
export type Palette = ReturnType<typeof withRoles>
export const palettes = { light: withRoles(light), dark: withRoles(dark) }

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
  display: 'BricolageGrotesque_700Bold',
  displayBold: 'BricolageGrotesque_800ExtraBold',
}

export function useTheme(): { c: Palette; dark: boolean } {
  const isDark = useColorScheme() === 'dark'
  return { c: isDark ? palettes.dark : palettes.light, dark: isDark }
}
