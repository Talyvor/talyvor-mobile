import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo, Animated, Text } from 'react-native'

import { AgentCard } from '../components/card'
import { Breathe, EffectsLayer, Frost, RoundRing, Shine } from '../components/effects'
import { AgentFundingSheet } from '../components/agent-funding'
import { Button, Screen, Toggle } from '../components/ui'
import { celebrate, forgetEffects, moneyMoved, opened } from '../effects'
import { forgetReduceMotion } from '../motion'
import { palettes } from '../theme'

// B61.130 — the phone's special openings, transitions and buttons (pocket-live DESIGN.md section 15): the opening after
// the passcode, the pulse and the ring when money moves, the still grey streams while paused, the burst, the ripple and
// the tick on buttons, the ring on round actions, the breathing waiting row, the stretching switch, the band of light and
// the frost on a card. With Reduce Motion on none of them starts, and a small job's tick follows the server's answer.

jest.setTimeout(30_000)

jest.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }))
jest.mock('expo-audio', () => ({ setAudioModeAsync: async () => undefined, createAudioPlayer: () => ({ seekTo: async () => undefined, play: () => undefined }) }))
let mockFunding: () => Promise<unknown> = async () => ({})
const mockFundingCalls: unknown[][] = []
const mockClient = {
  account: async () => ({ account_type: 'business', money_kind: 'fiat' }),
  moneyAccounts: async () => ({
    accounts: [
      { id: 'acc_usd', currency: 'USD', purpose: 'company', status: 'open', live_minor: 9_000 },
      { id: 'acc_r_usd', agent_id: 'ag_1', currency: 'USD', purpose: 'agent', status: 'open', live_minor: 1_000 },
    ],
  }),
  capabilities: async () => ({ capabilities: [] }),
  agentFunding: (...args: unknown[]) => {
    mockFundingCalls.push(args)
    return mockFunding()
  },
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, signedIn: true }) }))
jest.mock('expo-crypto', () => ({ randomUUID: () => 'key-1' }))

/** Every animation started, of any kind, held where it starts: in jest the native driver ends an animation at once, so
 * an effect that takes itself away when it ends would be gone before it could be seen. */
function holdAnimations() {
  const started = jest.fn()
  for (const kind of ['timing', 'spring', 'loop'] as const) {
    const real = Animated[kind] as (...a: unknown[]) => Animated.CompositeAnimation
    jest.spyOn(Animated, kind).mockImplementation(((...a: unknown[]) => ({ ...real(...a), start: () => started(kind, a[1]) })) as never)
  }
  return started
}

async function settle(reduce: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduce)
}

const hidden = { includeHiddenElements: true }

/** Every one of section 15's moments on one screen: Home's background as the app opens, a main button, a switch, a
 * round action's ring, the waiting row's halo and a frozen card catching the light. */
function Everything() {
  return (
    <>
      <Screen backdrop="full">
        <Button primary label="Move $10.00" onPress={() => undefined} />
        <Toggle label="Freeze card" value={false} onValueChange={() => undefined} />
        <RoundRing n={1} size={48} />
        <Breathe radius={16} />
        <Shine width={300} height={190} />
        <Frost on width={300} height={190} />
      </Screen>
      <EffectsLayer />
    </>
  )
}

beforeEach(() => {
  jest.restoreAllMocks()
  forgetReduceMotion()
  forgetEffects()
  mockFundingCalls.length = 0
})

test('with Reduce Motion on, none of the openings, transitions or buttons start', async () => {
  await settle(true)
  opened()
  const started = holdAnimations()
  await render(<Everything />)
  await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled())
  await act(async () => {})
  await act(async () => {
    moneyMoved('sent')
    moneyMoved('approved')
    celebrate()
    opened()
  })
  await fireEvent(screen.getByRole('button', { name: 'Move $10.00' }), 'pressIn', { nativeEvent: { locationX: 10, locationY: 10 } })
  await fireEvent(screen.getByRole('switch'), 'pressIn')
  for (const id of ['effects-layer', 'effect-ring', 'effect-burst', 'backdrop-pulse', 'ripple', 'round-ring', 'breathe', 'card-shine'])
    expect(screen.queryByTestId(id, hidden)).toBeNull()
  expect(started).not.toHaveBeenCalled()
  // The frost still says the card is frozen: it stands drawn, without crossing.
  expect(screen.getByTestId('card-frost', hidden)).toBeTruthy()
})

test('with Reduce Motion off, each of them starts on the native driver', async () => {
  await settle(false)
  opened()
  const started = holdAnimations()
  await render(<Everything />)
  await waitFor(() => expect(screen.getByTestId('card-shine', hidden)).toBeTruthy())
  await act(async () => {
    moneyMoved('sent')
    celebrate()
  })
  await fireEvent(screen.getByRole('button', { name: 'Move $10.00' }), 'pressIn', { nativeEvent: { locationX: 10, locationY: 10 } })
  for (const id of ['effect-ring', 'effect-burst', 'backdrop-pulse', 'ripple', 'round-ring', 'breathe'])
    expect(screen.queryAllByTestId(id, hidden).length).toBeGreaterThan(0)
  // The streams draw in over 900 ms as the app opens, and every effect moves on the native driver.
  expect(started).toHaveBeenCalledWith('timing', expect.objectContaining({ toValue: 1, duration: 900, useNativeDriver: true }))
  for (const [kind, config] of started.mock.calls) if (kind !== 'loop') expect(config).toEqual(expect.objectContaining({ useNativeDriver: true }))
})

test('money moved inside the account is the pulse alone; added and approved ring green, sent rings in the page colour', async () => {
  await settle(false)
  holdAnimations()
  await render(<Everything />)
  await waitFor(() => expect(screen.getByTestId('card-shine', hidden)).toBeTruthy())
  await act(async () => moneyMoved('inside'))
  expect(screen.queryAllByTestId('backdrop-pulse', hidden).length).toBeGreaterThan(0)
  expect(screen.queryByTestId('effect-ring', hidden)).toBeNull()
  await act(async () => moneyMoved('in'))
  // react-native-svg carries a stop's colour as its number.
  expect(JSON.stringify(screen.getByTestId('effect-ring', hidden))).toContain(`[0.52,${parseInt(palettes.light.success.slice(1), 16)},`)
})

test('while every agent is paused the streams stand still in grey, and they flow in colour again on resume', async () => {
  await settle(false)
  const loop = jest.spyOn(Animated, 'loop')
  const { rerender } = await render(
    <Screen backdrop="full" still>
      <Text>Home</Text>
    </Screen>,
  )
  await waitFor(() => expect(loop).toHaveBeenCalled())
  expect(screen.getAllByTestId('backdrop-still', hidden)).toHaveLength(3)
  const loopsWhileStill = loop.mock.calls.length
  await rerender(
    <Screen backdrop="full">
      <Text>Home</Text>
    </Screen>,
  )
  await waitFor(() => expect(loop.mock.calls.length).toBeGreaterThan(loopsWhileStill))
  await waitFor(() => expect(screen.queryByTestId('backdrop-still', hidden)).toBeNull(), { timeout: 3000 })
})

test('a card that is frozen wears the frost; one that is not, none', async () => {
  await settle(false)
  const agent = { id: 'ag_1', name: 'Atlas', description: 'Research', colour: 'cobalt' }
  const { rerender } = await render(<AgentCard agent={agent} width={342} />)
  expect(screen.queryByTestId('card-frost', hidden)).toBeNull()
  await rerender(<AgentCard agent={agent} width={342} frozen />)
  expect(screen.getByTestId('card-frost', hidden)).toBeTruthy()
})

test('a small job sends its request on the press, and the tick follows the answer before the sheet closes', async () => {
  await settle(false)
  let answer: (v: unknown) => void = () => undefined
  mockFunding = () => new Promise((done) => (answer = done))
  const onClose = jest.fn()
  const onDone = jest.fn()
  await render(<AgentFundingSheet agent={{ id: 'ag_1', name: 'Research' }} direction="to_agent" onClose={onClose} onDone={onDone} />)
  const move = await screen.findByRole('button', { name: 'Move $100.00' })
  await fireEvent.press(move)
  // Sent at once, with no tick until Lens answers.
  expect(mockFundingCalls).toHaveLength(1)
  expect(screen.queryByTestId('done-tick', hidden)).toBeNull()
  await act(async () => answer({ amount_minor: 10_000, currency: 'USD' }))
  expect(screen.getByTestId('done-tick', hidden)).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
  // While it ticks the button takes no press, so nothing is sent twice.
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }))
  expect(mockFundingCalls).toHaveLength(1)
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(onDone).toHaveBeenCalledWith('$100.00 moved to Research.')
})

test('a refusal draws no tick', async () => {
  await settle(false)
  const { BffError } = jest.requireActual('@talyvor/bff-client') as typeof import('@talyvor/bff-client')
  mockFunding = async () => {
    throw new BffError(422, '/api/money/accounts/acc_r_usd/funding', 'That is more than the account holds')
  }
  const onClose = jest.fn()
  await render(<AgentFundingSheet agent={{ id: 'ag_1', name: 'Research' }} direction="to_agent" onClose={onClose} onDone={() => undefined} />)
  await fireEvent.press(await screen.findByRole('button', { name: 'Move $100.00' }))
  await waitFor(() => expect(mockFundingCalls).toHaveLength(1))
  await act(async () => {})
  expect(screen.queryByTestId('done-tick', hidden)).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
})
