import { render, screen } from '@testing-library/react-native'
import { AccessibilityInfo, StyleSheet, Text, useColorScheme, useWindowDimensions } from 'react-native'

import { Card, Screen } from '../components/ui'

// B61.126 — the colour fills the whole screen, top to bottom, with no fade into the page, in five washes
// (design/pocket-live/DESIGN.md section 6.0); cards are frosted glass over it, not solid grey.

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => null) }))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: jest.fn() }))
const scheme = useColorScheme as jest.Mock
const size = useWindowDimensions as jest.Mock

afterEach(() => jest.restoreAllMocks())

it.each(['light', 'dark'] as const)('the glass covers the whole screen in %s, in five washes and with no fade', async (mode) => {
  scheme.mockReturnValue(mode)
  size.mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 })
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
  await render(
    <Screen>
      <Text>Agents</Text>
    </Screen>,
  )
  await screen.findByText('Agents')
  const glass = screen.getByTestId('backdrop-glass', { includeHiddenElements: true })
  expect(StyleSheet.flatten(glass.props.style)).toMatchObject({ top: 0, height: 844 })
  expect(screen.queryAllByTestId('backdrop-wash', { includeHiddenElements: true })).toHaveLength(5)
  expect(screen.queryByTestId('backdrop-fade', { includeHiddenElements: true })).toBeNull()
})

it.each([
  ['light', 'rgba(255,255,255,0.66)', 'rgba(17,18,22,0.06)'],
  ['dark', 'rgba(15,16,19,0.68)', 'rgba(242,243,245,0.06)'],
] as const)('a card on the glass is the page colour see-through, with a hairline, in %s', async (mode, fill, hairline) => {
  scheme.mockReturnValue(mode)
  size.mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 })
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
  await render(
    <Screen>
      <Card testID="card">
        <Text>Limits</Text>
      </Card>
    </Screen>,
  )
  const card = StyleSheet.flatten((await screen.findByTestId('card')).props.style)
  expect(card.backgroundColor).toBe(fill)
  expect(card.boxShadow).toBe(`inset 0 0 0 1px ${hairline}`)
})
