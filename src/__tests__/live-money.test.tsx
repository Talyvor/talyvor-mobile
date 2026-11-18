import { act, render, screen, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo, Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { forgetTopLine, Landed, say, TopLine, TOP_LINE_MS, useLanded } from '../components/live'
import { Money } from '../components/money'
import { LoadState } from '../components/ui'
import { forgetReduceMotion } from '../motion'

// B61.78 — Pocket Live on the phone: money rolls, a row that arrives lands, loading draws shapes, one line at the top.

beforeEach(() => {
  jest.restoreAllMocks()
  forgetReduceMotion()
  forgetTopLine()
})

afterEach(() => {
  jest.useRealTimers()
})

// The figure drawn, whatever is read; the screen reader reads the label `$500.00`.
const drawn = () => (screen.getByLabelText('$500.00'), screen.getAllByText(/^\$/).map((n) => n.props.children as string))

test('a balance that changes rolls to its new figure, and a screen reader hears only the new one', async () => {
  jest.useFakeTimers()
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
  const view = await render(<Money minor={10_000} currency="USD" />)
  await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled())
  await act(async () => {})

  await view.rerender(<Money minor={50_000} currency="USD" />)
  await act(async () => {
    jest.advanceTimersByTime(120)
  })
  // Mid-roll the figure drawn is one in between, and what is read is the final figure, never the one drawn.
  const between = drawn()
  expect(between).toHaveLength(1)
  expect(between[0]).not.toBe('$500.00')
  expect(between[0]).not.toBe('$100.00')
  expect(screen.queryByLabelText(between[0] as string)).toBeNull()

  await act(async () => {
    jest.advanceTimersByTime(800)
  })
  expect(drawn()).toEqual(['$500.00'])
})

test('with Reduce Motion on a new figure draws at once', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
  const view = await render(<Money minor={10_000} currency="USD" />)
  await act(async () => {})
  await view.rerender(<Money minor={50_000} currency="USD" />)
  expect(drawn()).toEqual(['$500.00'])
})

test('loading draws grey shapes, never a spinner and never a figure', async () => {
  await render(<LoadState loading error={null} />)
  const shapes = screen.getByTestId('loading-shapes')
  expect(shapes.props.accessibilityLabel).toBe('Reading…')
  expect(screen.queryByText(/\d/)).toBeNull()
  expect(JSON.stringify(screen.toJSON())).not.toContain('ActivityIndicator')
})

function List({ keys, ready }: { keys: string[]; ready: boolean }) {
  const landed = useLanded(keys, ready)
  return (
    <>
      {keys.map((k) => (
        <Landed key={k} landed={landed(k)}>
          <Text>{k}</Text>
        </Landed>
      ))}
    </>
  )
}

test('a row that arrives after the first read lands; the rows read first do not', async () => {
  const view = await render(<List keys={[]} ready={false} />)
  await view.rerender(<List keys={['a', 'b']} ready />)
  expect(screen.queryAllByTestId('landed')).toHaveLength(0)
  await view.rerender(<List keys={['c', 'a', 'b']} ready />)
  const landed = screen.getAllByTestId('landed')
  expect(landed).toHaveLength(1)
  expect(landed[0]).toHaveTextContent('c')
})

test('one line at the top says what happened for 2.3 s, and a screen reader hears it once', async () => {
  jest.useFakeTimers()
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {})
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <TopLine />
    </SafeAreaProvider>,
  )
  await act(async () => say('Approved. $64.00 to Acme'))
  expect(screen.getByTestId('top-line', { includeHiddenElements: true })).toHaveTextContent('Approved. $64.00 to Acme')
  expect(announce).toHaveBeenCalledTimes(1)
  expect(announce).toHaveBeenCalledWith('Approved. $64.00 to Acme')
  await act(async () => {
    jest.advanceTimersByTime(TOP_LINE_MS - 100)
  })
  expect(screen.getByTestId('top-line', { includeHiddenElements: true })).toBeTruthy()
  await act(async () => {
    jest.advanceTimersByTime(200)
  })
  expect(screen.queryByTestId('top-line', { includeHiddenElements: true })).toBeNull()
})
