import { useColorScheme } from 'react-native'

// The brand's tokens (brand-v4/tokens/tokens.css): dark is primary, light follows the phone's setting.
const dark = {
  canvas: '#060A12',
  surface: '#081220',
  raised: '#0E1A2A',
  line: 'rgba(126,147,171,0.18)',
  lineStrong: 'rgba(126,147,171,0.32)',
  ink: '#E6EEF7',
  inkMuted: '#7E93AB',
  label: '#90ACC0',
  accent: '#3AD6C0',
  onAccent: '#060A12',
  accentTint: '#0E2B2E',
  positive: '#45C77F',
  caution: '#D6A93C',
  critical: '#F0685C',
}
const light: typeof dark = {
  canvas: '#F4F7FB',
  surface: '#FFFFFF',
  raised: '#FFFFFF',
  line: 'rgba(6,10,18,0.10)',
  lineStrong: 'rgba(6,10,18,0.20)',
  ink: '#060A12',
  inkMuted: '#46586E',
  label: '#646B79',
  accent: '#0F7A6C',
  onAccent: '#FFFFFF',
  accentTint: '#C9E6E0',
  positive: '#1D7A45',
  caution: '#8A6A12',
  critical: '#BF3B2E',
}
export type Palette = typeof dark
export const palettes = { dark, light }

export const fonts = {
  ui: 'SpaceGrotesk_400Regular',
  uiMedium: 'SpaceGrotesk_500Medium',
  uiBold: 'SpaceGrotesk_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
}

export function useTheme(): { c: Palette; dark: boolean } {
  const isDark = useColorScheme() !== 'light'
  return { c: isDark ? dark : light, dark: isDark }
}
