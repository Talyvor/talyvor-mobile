import { act, render, screen, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo, Animated, Text, useColorScheme } from 'react-native'

import { ACCOUNT_HUES } from '../components/backdrop'
import { Screen } from '../components/ui'
import { palettes } from '../theme'

// B61.71 — every screen draws Talyvor's moving background once, inside Screen, hidden from screen readers and never
// taking a touch (design/pocket-live/DESIGN.md section 6).

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => null) }))
const scheme = useColorScheme as jest.Mock

async function draw(reduce: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduce)
  return await render(
    <Screen>
      <Text>Agents</Text>
    </Screen>,
  )
}

afterEach(() => jest.restoreAllMocks())

it.each(['light', 'dark'] as const)('Screen draws the background once in %s, hidden from screen readers and untouchable', async (mode) => {
  scheme.mockReturnValue(mode)
  await draw(false)
  await screen.findByText('Agents')
  const all = screen.queryAllByTestId('backdrop', { includeHiddenElements: true })
  expect(all).toHaveLength(1)
  expect(all[0].props.accessibilityElementsHidden).toBe(true)
  expect(all[0].props.importantForAccessibility).toBe('no-hide-descendants')
  expect(all[0].props.pointerEvents).toBe('none')
  // Hidden from a screen reader's view of the screen, so nothing in it is read.
  expect(screen.queryByTestId('backdrop')).toBeNull()
  // The glass fades into this theme's page colour.
  expect(JSON.stringify(screen.toJSON())).toContain(palettes[mode].page)
})

it('moves its washes, sheen and streams, and with Reduce Motion on nothing animates', async () => {
  scheme.mockReturnValue(null)
  const loop = jest.spyOn(Animated, 'loop')
  await draw(false)
  await screen.findByText('Agents')
  // The control: with Reduce Motion off, the three washes, the sheen and the three sways each loop.
  await waitFor(() => expect(loop).toHaveBeenCalledTimes(7))
  screen.unmount()
  loop.mockClear()

  await draw(true)
  await screen.findByText('Agents')
  await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled())
  await act(async () => undefined)
  expect(loop).not.toHaveBeenCalled()
})

it('takes the account’s two colours: Personal tangerine and cobalt, Business cobalt and mint', () => {
  expect(ACCOUNT_HUES.personal).toEqual(['#FF7A1A', '#2F5BFF'])
  expect(ACCOUNT_HUES.business).toEqual(['#2F5BFF', '#16C79A'])
})
