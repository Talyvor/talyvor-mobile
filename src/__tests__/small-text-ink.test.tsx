import { render, screen } from '@testing-library/react-native'
import { AccessibilityInfo, useColorScheme } from 'react-native'

import { Card, Eyebrow, Screen } from '../components/ui'
import { palettes } from '../theme'

// B61.99 — small text with no card under it sits on the moving background, so it is ink-2; on a card it keeps ink-3
// (design/pocket-live/DESIGN.md section 6). The pixels themselves are measured by scripts/pocket-contrast.mjs.

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => null) }))
const scheme = useColorScheme as jest.Mock

afterEach(() => jest.restoreAllMocks())

it.each(['light', 'dark'] as const)('a section label is ink-2 on the background and ink-3 on a card, in %s', async (mode) => {
  scheme.mockReturnValue(mode)
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
  await render(
    <Screen>
      <Eyebrow>Saved payees</Eyebrow>
      <Card>
        <Eyebrow>Limits</Eyebrow>
      </Card>
    </Screen>,
  )
  const colour = (el: ReturnType<typeof screen.getByText>) => [el.props.style].flat(9).reduce((c, s) => s?.color ?? c, undefined)
  expect(colour(await screen.findByText('Saved payees'))).toBe(palettes[mode].ink2)
  expect(colour(screen.getByText('Limits'))).toBe(palettes[mode].ink3)
})
