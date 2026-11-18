import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo, Animated, Pressable, StyleSheet } from 'react-native'

import { Face } from '../components/face'
import { FlightSource, FlightTarget, PictureFlight, measuring, usePageArrival, useTakeOff, type Rect } from '../components/picture-flight'
import { durations, easings, forgetReduceMotion } from '../motion'

// B61.79 — opening an agent from the list grows its face into the face at the top of its page over 420 ms.

let mockTransitionEnd: ((e: { data?: { closing?: boolean } }) => void) | null = null
const mockNavigation = {
  addListener: (_: string, on: (e: { data?: { closing?: boolean } }) => void) => {
    mockTransitionEnd = on
    return () => {}
  },
}
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), useNavigation: () => mockNavigation }))

const remy = { id: 'agt_remy', name: 'Remy', colour: 'cobalt' }
const row: Rect = { x: 18, y: 420, width: 44, height: 44 }
const top: Rect = { x: 36, y: 150, width: 60, height: 60 }

function Row() {
  const { ref, takeOff, flying } = useTakeOff(remy, 'happy')
  return (
    <Pressable accessibilityRole="link" accessibilityLabel="Remy, running" onPress={takeOff}>
      <FlightSource face={ref} flying={flying}>
        <Face agent={remy} size={44} />
      </FlightSource>
    </Pressable>
  )
}
function Page({ drawn }: { drawn: boolean }) {
  usePageArrival(remy.id)
  return drawn ? (
    <FlightTarget agentId={remy.id}>
      <Face agent={remy} size={60} />
    </FlightTarget>
  ) : null
}
const App = ({ open, drawn }: { open: boolean; drawn: boolean }) => (
  <>
    <Row />
    {open ? <Page drawn={drawn} /> : null}
    <PictureFlight />
  </>
)
// The flight is hidden from screen readers, which hear the page's own face.
const hidden = { includeHiddenElements: true }
const opacity = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).opacity

async function renderList(reduce: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduce)
  jest.spyOn(measuring, 'inWindow').mockImplementation((view, done) => done(screen.queryByTestId('flight-target') ? top : row))
  const r = await render(<App open={false} drawn={false} />)
  await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled())
  await act(async () => {})
  return r
}

beforeEach(() => {
  jest.restoreAllMocks()
  forgetReduceMotion()
  mockTransitionEnd = null
})
afterEach(() => jest.useRealTimers())

test('the face pressed in the list waits over the sliding page, then grows into the face at its top over 420 ms', async () => {
  const timing = jest.spyOn(Animated, 'timing')
  const { rerender } = await renderList(false)
  jest.useFakeTimers()
  await fireEvent.press(screen.getByRole('link'))
  await rerender(<App open drawn={false} />)
  // Lifted off: drawn above both screens where the row's face was, and the row's own face hidden.
  expect(screen.getByTestId('picture-flight', hidden).props.style).toMatchObject({ left: row.x, top: row.y })
  expect(opacity('flight-source')).toBe(0)

  // The page slides in and its read answers: its face is drawn, hidden, and the flight sets off for it.
  await rerender(<App open drawn />)
  await fireEvent(screen.getByTestId('flight-target'), 'layout', { nativeEvent: { layout: top } })
  expect(opacity('flight-target')).toBe(0)
  await act(async () => mockTransitionEnd?.({ data: { closing: false } }))
  expect(screen.getByTestId('picture-flight', hidden).props.style).toMatchObject({ left: top.x, top: top.y })
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: durations.page, easing: easings.out, useNativeDriver: true }))
  expect(durations.page).toBe(420)

  await act(async () => jest.advanceTimersByTime(durations.page + 50))
  expect(screen.queryByTestId('picture-flight', hidden)).toBeNull()
  expect(opacity('flight-target')).toBe(1)
  expect(opacity('flight-source')).toBe(1)
})

test('a page that has not drawn its face a page’s time after arriving drops the flight', async () => {
  const { rerender } = await renderList(false)
  jest.useFakeTimers()
  await fireEvent.press(screen.getByRole('link'))
  await rerender(<App open drawn={false} />)
  await act(async () => mockTransitionEnd?.({ data: { closing: false } }))
  expect(screen.getByTestId('picture-flight', hidden)).toBeTruthy()
  await act(async () => jest.advanceTimersByTime(durations.page))
  expect(screen.queryByTestId('picture-flight', hidden)).toBeNull()
  expect(opacity('flight-source')).toBe(1)
})

test('with Reduce Motion on, nothing lifts off and the page’s face shows at once', async () => {
  const timing = jest.spyOn(Animated, 'timing')
  const { rerender } = await renderList(true)
  await fireEvent.press(screen.getByRole('link'))
  await rerender(<App open drawn />)
  await act(async () => mockTransitionEnd?.({ data: { closing: false } }))
  expect(screen.queryByTestId('picture-flight', hidden)).toBeNull()
  expect(opacity('flight-target')).toBe(1)
  expect(timing).not.toHaveBeenCalled()
})
