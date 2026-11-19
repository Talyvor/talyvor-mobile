import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo } from 'react-native'

import { BottomSheet } from '../components/pay-sheet'
import { Body } from '../components/ui'

// B61.77 — every decision and detail on the phone opens as a sheet with a grab bar (pocket-live DESIGN.md section 5,
// move 3): dragging the bar down more than 110 points closes it, a shorter drag springs back, Close is always there too,
// and focus moves into the sheet when it opens. Each sheet's own open, Close and return is tested with its screen.

/** Drags the grab bar down by `dy` points and lets go. */
async function drag(dy: number) {
  const grab = screen.getByTestId('sheet-grab')
  expect(grab.props.onStartShouldSetResponder()).toBe(true)
  await fireEvent(grab, 'responderGrant', { nativeEvent: { pageY: 300 } })
  await fireEvent(grab, 'responderMove', { nativeEvent: { pageY: 300 + dy } })
  await fireEvent(grab, 'responderRelease', { nativeEvent: { pageY: 300 + dy } })
}

test('dragging the grab bar down more than 110 points closes the sheet, and a shorter drag leaves it open', async () => {
  const onClose = jest.fn()
  await render(
    <BottomSheet visible onClose={onClose}>
      <Body>Add money</Body>
    </BottomSheet>,
  )
  await drag(80)
  expect(onClose).not.toHaveBeenCalled()
  await drag(120)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('Close is there and closes it, and focus moves to Close when the sheet opens', async () => {
  const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
  const onClose = jest.fn()
  await render(
    <BottomSheet visible onClose={onClose}>
      <Body>Add money</Body>
    </BottomSheet>,
  )
  const close = screen.getByRole('button', { name: 'Close' })
  await waitFor(() => expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus'))
  await fireEvent.press(close)
  expect(onClose).toHaveBeenCalledTimes(1)
  focus.mockRestore()
})

test('a sheet only its own buttons put away (a recovery code shown once) does not drag away', async () => {
  await render(
    <BottomSheet visible>
      <Body>Your recovery code</Body>
    </BottomSheet>,
  )
  expect(screen.getByTestId('sheet-grab').props.onStartShouldSetResponder()).toBe(false)
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
})
