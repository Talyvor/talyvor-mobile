import Svg, { Circle, Path, Rect } from 'react-native-svg'

import { useTheme } from '../theme'

// B57.64 — Pocket's line icons, path for path from the web's (talyvor-suite B57.6, packages/ui/src/pocket/Icon.tsx):
// a 24-unit grid, 1.9 stroke, round caps and joins, in the colour given.
const ICONS = {
  home: (
    <>
      <Path d="M4 11.5 12 5l8 6.5" />
      <Path d="M6.5 10v9h11v-9" />
      <Path d="M10 19v-5h4v5" />
    </>
  ),
  approvals: (
    <>
      <Circle cx="12" cy="12" r="8" />
      <Path d="m8.5 12.3 2.4 2.4 4.6-5" />
    </>
  ),
  agents: (
    <>
      <Rect x="5" y="7" width="14" height="11" rx="5" />
      <Circle cx="9.7" cy="12" r="1" fill="currentColor" />
      <Circle cx="14.3" cy="12" r="1" fill="currentColor" />
      <Path d="M12 4v3" />
    </>
  ),
  payments: (
    <>
      <Path d="M5 9h12l-3-3" />
      <Path d="M19 15H7l3 3" />
    </>
  ),
  statements: (
    <>
      <Path d="M7 3.5h7l4 4V20.5H7z" />
      <Path d="M14 3.5V8h4" />
      <Path d="M9.5 12h6M9.5 15.5h6" />
    </>
  ),
  spending: (
    <>
      <Circle cx="12" cy="12" r="8" />
      <Path d="M12 4v8l5.7 5.7" />
      <Path d="M12 12h8" />
    </>
  ),
  marketplace: (
    <>
      <Path d="M4.5 9.5 6 5h12l1.5 4.5" />
      <Path d="M4.5 9.5c0 1.6 1.2 2.6 2.6 2.6S9.8 11 9.8 9.5c0 1.6 1.1 2.6 2.2 2.6s2.2-1 2.2-2.6c0 1.6 1.2 2.6 2.6 2.6s2.6-1 2.6-2.6" />
      <Path d="M6 12v7.5h12V12" />
    </>
  ),
  rooms: (
    <>
      <Circle cx="9" cy="9" r="3" />
      <Circle cx="16.5" cy="10" r="2.4" />
      <Path d="M3.8 19c.5-3 2.6-4.6 5.2-4.6s4.7 1.6 5.2 4.6" />
      <Path d="M14.6 15.3c2.6-.4 4.9.9 5.6 3.7" />
    </>
  ),
  chat: <Path d="M5 6.5h14v9.5H11l-4 3.5v-3.5H5z" />,
  scan: (
    <>
      <Path d="M5 19V5" />
      <Path d="M5 19h14" />
      <Path d="m8 15 3.5-4 3 2.5L19 8" />
    </>
  ),
  work: (
    <>
      <Path d="M10 7h9M10 12h9M10 17h9" />
      <Path d="m4.5 7 1 1 2-2M4.5 12l1 1 2-2M4.5 17l1 1 2-2" />
    </>
  ),
  code: <Path d="m9 8-4 4 4 4M15 8l4 4-4 4" />,
  billing: (
    <>
      <Rect x="3" y="6.5" width="18" height="11" rx="2" />
      <Circle cx="12" cy="12" r="2.6" />
      <Path d="M6.5 10v4M17.5 10v4" />
    </>
  ),
  settings: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </>
  ),
  pause: <Path d="M9 6.5v11M15 6.5v11" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="6" />
      <Path d="m20 20-4.5-4.5" />
    </>
  ),
  bell: (
    <>
      <Path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
      <Path d="M10 20.5h4" />
    </>
  ),
  plus: <Path d="M12 5v14M5 12h14" />,
  chev: <Path d="M10 7l5 5-5 5" />,
  faceid: (
    <>
      <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <Path d="M9 9.5v1.2M15 9.5v1.2M12 9.5v3.5h-1" />
      <Path d="M9.3 15.3c1.6 1.3 3.8 1.3 5.4 0" />
    </>
  ),
  lock: (
    <>
      <Rect x="5" y="11" width="14" height="9" rx="2.5" />
      <Path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  key: (
    <>
      <Circle cx="8" cy="15" r="3.5" />
      <Path d="m10.5 12.5 7.5-7.5M15.5 7.5l2.5 2.5M13.5 9.5l2 2" />
    </>
  ),
  check: <Path d="M6 12.5l4 4 8-9" />,
  x: <Path d="m7 7 10 10M17 7 7 17" />,
  clock: (
    <>
      <Circle cx="12" cy="12" r="8" />
      <Path d="M12 7.5V12l3 2" />
    </>
  ),
  card: (
    <>
      <Rect x="3.5" y="6" width="17" height="12" rx="3" />
      <Path d="M3.5 10h17" />
    </>
  ),
  arrow: <Path d="M5 12h14M13 6l6 6-6 6" />,
  copy: (
    <>
      <Rect x="8" y="8" width="11" height="11" rx="2.5" />
      <Path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" />
    </>
  ),
  shield: (
    <>
      <Path d="M12 3.5 19 6v5.5c0 4.3-3 7.4-7 9-4-1.6-7-4.7-7-9V6z" />
      <Path d="m9 12 2.2 2.2 4-4.4" />
    </>
  ),
  phone: (
    <>
      <Rect x="7" y="3" width="10" height="18" rx="3" />
      <Path d="M11 18h2" />
    </>
  ),
  send: (
    <>
      <Path d="M5 12 19 5l-4 14-3.5-5.5z" />
      <Path d="m11.5 13.5 3.5-3.5" />
    </>
  ),
  download: (
    <>
      <Path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5" />
      <Path d="M5 19.5h14" />
    </>
  ),
  invoices: (
    <>
      <Path d="M7 3.5h10v17l-2.5-1.6-2.5 1.6-2.5-1.6L7 20.5z" />
      <Path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" />
    </>
  ),
  coin: (
    <>
      <Circle cx="12" cy="12" r="7.5" />
      <Circle cx="12" cy="12" r="3.5" />
    </>
  ),
  model: (
    <>
      <Rect x="6" y="6" width="12" height="12" rx="3" />
      <Path d="M10 3.5v2.5M14 3.5v2.5M10 18v2.5M14 18v2.5M3.5 10h2.5M3.5 14h2.5M18 10h2.5M18 14h2.5" />
    </>
  ),
  keyboard: (
    <>
      <Rect x="3.5" y="6.5" width="17" height="11" rx="2.5" />
      <Path d="M7.5 10h1M11.5 10h1M15.5 10h1M8 14h8" />
    </>
  ),
} as const

export type IconName = keyof typeof ICONS
export const iconNames = Object.keys(ICONS) as IconName[]

/** One of Pocket's line icons. Decorative: the label beside it names the thing. */
export function Icon({ name, size = 20, color }: { name: IconName; /** 20 in a row or a button, 16 beside small text. */ size?: number; color?: string }) {
  const { c } = useTheme()
  const ink = color ?? c.ink
  return (
    <Svg
      testID={`icon-${name}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      color={ink}
      fill="none"
      stroke={ink}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {ICONS[name]}
    </Svg>
  )
}
