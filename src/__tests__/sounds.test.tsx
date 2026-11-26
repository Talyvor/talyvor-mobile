import { BffError, type BffClient, type CurrencyAccount } from '@talyvor/bff-client'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native'
import { Appearance } from 'react-native'

import { AmountPad } from '../components/amount-pad'
import { LookAndSound, LOOK_WORDS } from '../components/look-and-sound'
import { StartEveryAgentSheet } from '../components/start-every-agent'
import { Toggle } from '../components/ui'
import { WalletSheet } from '../components/wallet-actions'
import { shows } from '../account'
import PauseAll from '../app/pause-all'

// B61.127 — the phone's sounds (pocket-live DESIGN.md section 15) and Settings › Look and sound. The other moments are
// held where their screens are tested: sent and refused in pay-a-person and instant-transfer, approved, declined and
// refused in approval-sheet, unlock and key in door-and-lock, freeze and unfreeze in phone-cards, celebrate in new-agent,
// moved in agent-funding.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
/** expo-audio: each player made, in order, and which of them played. */
const mockAudio = { made: [] as unknown[], played: [] as number[], modes: [] as unknown[] }
jest.mock('expo-audio', () => ({
  setAudioModeAsync: async (m: unknown) => void mockAudio.modes.push(m),
  createAudioPlayer: (source: unknown) => {
    const n = mockAudio.made.push(source) - 1
    return { seekTo: async () => undefined, play: () => void mockAudio.played.push(n) }
  },
}))
let mockHandler: { handleNotification: (n: unknown) => Promise<{ shouldPlaySound: boolean }> } | null = null
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('../../__mocks__/expo-notifications'),
  setNotificationHandler: (h: typeof mockHandler) => void (mockHandler = h),
}))
const mockClient: Record<string, jest.Mock> = {}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, signedIn: true }) }))
const mockResume = jest.fn(async () => '')
jest.mock('../keys', () => ({
  ...jest.requireActual('../keys'),
  biometricName: 'Face ID',
  phoneKey: async () => ({ id: 'dk_1', here: true, owner: '' }),
  checkItsYou: async () => 'ok',
  resumeWithThisPhone: () => mockResume(),
}))
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), canDismiss: () => false, canGoBack: () => false } }))
jest.mock('expo-crypto', () => ({ randomUUID: () => 'key-1' }))

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the module under test, fresh for each test
const fresh = () => require('../sound') as typeof import('../sound')
/** The sounds played, by name: loadSounds makes the players in SOUND_NAMES order, as the app does when it opens. */
const played = () => mockAudio.played.map((n) => fresh().SOUND_NAMES[n % 15])

beforeEach(() => {
  fresh().forgetSounds()
  mockStore.clear()
  mockAudio.made = []
  mockAudio.played = []
  mockAudio.modes = []
  for (const k of Object.keys(mockClient)) delete mockClient[k]
  fresh().loadSounds()
})
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)))

describe('sound.ts', () => {
  test('the fifteen sounds of section 15, each loaded once however often it plays', async () => {
    const s = fresh()
    expect([...s.SOUND_NAMES].sort()).toEqual(['approved', 'celebrate', 'declined', 'freeze', 'key', 'moneyin', 'moved', 'pause', 'refused', 'request', 'resume', 'sent', 'tick', 'unfreeze', 'unlock'])
    expect(mockAudio.made).toHaveLength(15)
    s.play('sent')
    s.play('sent')
    await settle()
    expect(played()).toEqual(['sent', 'sent'])
    expect(mockAudio.made).toHaveLength(15)
    // The silent switch mutes them, and they mix with whatever else plays.
    expect(mockAudio.modes[0]).toEqual({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })
  })

  test('with Sounds off nothing plays, and the choice is kept on the phone', async () => {
    const s = fresh()
    await s.setSoundsOn(false)
    s.play('sent')
    s.outcome('approved')
    await settle()
    expect(played()).toEqual([])
    expect(mockStore.get('talyvor.sounds.off')).toBe('1')

    // The next time the app opens, it is still off.
    s.forgetSounds()
    s.loadSounds()
    await settle()
    s.play('refused')
    await settle()
    expect(played()).toEqual([])
  })

  test('switching Sounds on plays moneyin once', async () => {
    const s = fresh()
    await s.setSoundsOn(false)
    await s.setSoundsOn(true)
    await settle()
    expect(played()).toEqual(['moneyin'])
    expect(mockStore.has('talyvor.sounds.off')).toBe(false)
  })
})

describe('Settings › Look and sound', () => {
  test('the row says what is chosen; its sheet has the three looks and Sounds, on by default', async () => {
    const set = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined)
    await render(<LookAndSound />)
    expect(screen.getByText('Look and sound')).toBeTruthy()
    expect(screen.getByText('Follows your phone, sounds on')).toBeTruthy()
    await fireEvent.press(screen.getByText('Look and sound'))
    const sheet = within(await screen.findByTestId('look-and-sound-sheet'))
    expect(sheet.getAllByRole('radio').map((r) => [r.props.accessibilityLabel, r.props.accessibilityState.checked])).toEqual([
      ['Follow my phone. Light by day, dark by night', true],
      ['Light', false],
      ['Dark', false],
    ])
    const sounds = sheet.getByRole('switch', { name: 'Sounds' })
    expect(sounds.props.accessibilityState.checked).toBe(true)
    expect(sheet.getByText(LOOK_WORDS.soundsLine)).toBeTruthy()

    await fireEvent.press(sheet.getByRole('radio', { name: 'Dark' }))
    expect(set).toHaveBeenLastCalledWith('dark')
    expect(mockStore.get('talyvor.look')).toBe('dark')
    await fireEvent.press(sheet.getByRole('radio', { name: 'Follow my phone. Light by day, dark by night' }))
    expect(set).toHaveBeenLastCalledWith('unspecified')
    expect(mockStore.has('talyvor.look')).toBe(false)

    // The switch flips with tick, then is off; on again plays moneyin.
    await fireEvent.press(sounds)
    await settle()
    expect(played()).toEqual(['tick'])
    expect(sheet.getByRole('switch', { name: 'Sounds' }).props.accessibilityState.checked).toBe(false)
    expect(screen.getByText('Follows your phone, sounds off')).toBeTruthy()
    await fireEvent.press(sheet.getByRole('switch', { name: 'Sounds' }))
    await settle()
    expect(played()).toEqual(['tick', 'moneyin'])
    set.mockRestore()
  })
})

describe('the moments', () => {
  test('a switch flips with tick; a key on a keypad is key', async () => {
    const onValueChange = jest.fn()
    await render(
      <>
        <Toggle label="Freeze card" value={false} onValueChange={onValueChange} />
        <AmountPad typed="" currency="USD" onType={() => undefined} />
      </>,
    )
    await fireEvent.press(screen.getByRole('switch', { name: 'Freeze card' }))
    await fireEvent.press(screen.getByRole('button', { name: '4' }))
    await settle()
    expect(onValueChange).toHaveBeenCalledWith(true)
    expect(played()).toEqual(['tick', 'key'])
  })

  test('an agent’s request arriving in the app is request, never the phone’s own sound; other notices keep theirs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- read here, so the handler it sets is the mock's
    require('../push')
    const asks = await mockHandler!.handleNotification({ request: { content: { data: { type: 'agent_approval', approval_id: 'apr_1' } } } })
    const notice = await mockHandler!.handleNotification({ request: { content: { data: { type: 'spend_notice' } } } })
    await settle()
    expect(asks.shouldPlaySound).toBe(false)
    expect(notice.shouldPlaySound).toBe(true)
    expect(played()).toEqual(['request'])
  })

  test('Pause every agent is pause once Lens has paused them; Start every agent is resume', async () => {
    mockClient.book = jest.fn(async () => ({ agents: [], all_paused_at: null }))
    mockClient.pauseAll = jest.fn(async () => ({}))
    await render(<PauseAll />)
    await fireEvent.press(await screen.findByRole('button', { name: 'Pause every agent' }))
    await waitFor(() => expect(mockClient.pauseAll).toHaveBeenCalledTimes(1))
    await settle()
    expect(played()).toEqual(['pause'])

    await render(<StartEveryAgentSheet visible signs onClose={() => undefined} onStarted={() => undefined} />)
    await fireEvent.press(await screen.findByRole('button', { name: 'Start them with Face ID' }))
    await settle()
    expect(played()).toEqual(['pause', 'resume'])
  })

  test('Add money is moneyin once Lens has added it; a refusal is refused and never moneyin', async () => {
    const accounts = [{ id: 'acc_usd', currency: 'USD', purpose: 'company', status: 'open', name: '', balance_minor: 0, test_minor: 0, live_minor: 0 }] as CurrencyAccount[]
    const answers: (() => Promise<unknown>)[] = [
      async () => {
        throw new BffError(422, '/api/money/accounts/acc_usd/top-up', 'more than a Sandbox top-up may add', 'limit')
      },
      async () => ({}),
    ]
    mockClient.walletTopUp = jest.fn(() => answers.shift()!())
    const sheet = <WalletSheet action="top-up" client={mockClient as unknown as BffClient} shows={shows({ account_type: 'personal', money_kind: 'fiat' } as never)} accounts={accounts} hasKey onClose={() => undefined} onDone={() => undefined} />
    await render(sheet)
    await fireEvent.changeText(screen.getByLabelText('Amount'), '20')
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Add money with Face ID' }))
    await waitFor(() => expect(mockClient.walletTopUp).toHaveBeenCalledTimes(1))
    await settle()
    expect(played()).toEqual(['refused'])
    await fireEvent.press(screen.getByRole('button', { name: 'Add money with Face ID' }))
    await waitFor(() => expect(mockClient.walletTopUp).toHaveBeenCalledTimes(2))
    await settle()
    expect(played()).toEqual(['refused', 'moneyin'])
  })
})
