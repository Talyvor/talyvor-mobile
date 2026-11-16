import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import * as Haptics from 'expo-haptics'
import { AccessibilityInfo, Animated, Text } from 'react-native'

import { Press } from '../components/press'
import { forgetReduceMotion, haptic } from '../motion'

// B61.73 — the motion kit: one Press for every control, the haptics by kind, and Reduce Motion stopping every move.

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}))

async function renderPress(reduce: boolean, props: Partial<React.ComponentProps<typeof Press>> = {}) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduce)
  const onPress = jest.fn()
  await render(
    <Press accessibilityRole="button" onPress={onPress} {...props}>
      <Text>Pay</Text>
    </Press>,
  )
  await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled())
  await act(async () => {})
  return onPress
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.restoreAllMocks()
  forgetReduceMotion()
})

test('a press fires its action once, with a light haptic', async () => {
  const onPress = await renderPress(false)
  await fireEvent.press(screen.getByRole('button'))
  expect(onPress).toHaveBeenCalledTimes(1)
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1)
  expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light)
})

test('a decline has no haptic', async () => {
  const onPress = await renderPress(false, { haptic: false })
  await fireEvent.press(screen.getByRole('button'))
  expect(onPress).toHaveBeenCalledTimes(1)
  expect(Haptics.impactAsync).not.toHaveBeenCalled()
  expect(Haptics.notificationAsync).not.toHaveBeenCalled()
})

test('success and warning are notification haptics of their kind', () => {
  haptic('success')
  haptic('warning')
  expect(Haptics.notificationAsync).toHaveBeenNthCalledWith(1, Haptics.NotificationFeedbackType.Success)
  expect(Haptics.notificationAsync).toHaveBeenNthCalledWith(2, Haptics.NotificationFeedbackType.Warning)
  expect(Haptics.impactAsync).not.toHaveBeenCalled()
})

test('it shrinks to its kind with the native driver and springs back', async () => {
  const timing = jest.spyOn(Animated, 'timing')
  const spring = jest.spyOn(Animated, 'spring')
  await renderPress(false, { kind: 'round' })
  await fireEvent(screen.getByRole('button'), 'pressIn')
  await fireEvent(screen.getByRole('button'), 'pressOut')
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0.9, duration: 90, useNativeDriver: true }))
  expect(spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, damping: 18, stiffness: 220, useNativeDriver: true }))
})

test('with Reduce Motion on, no animation starts', async () => {
  const timing = jest.spyOn(Animated, 'timing')
  const spring = jest.spyOn(Animated, 'spring')
  const onPress = await renderPress(true)
  await fireEvent(screen.getByRole('button'), 'pressIn')
  await fireEvent(screen.getByRole('button'), 'pressOut')
  await fireEvent.press(screen.getByRole('button'))
  expect(timing).not.toHaveBeenCalled()
  expect(spring).not.toHaveBeenCalled()
  expect(onPress).toHaveBeenCalledTimes(1)
})
