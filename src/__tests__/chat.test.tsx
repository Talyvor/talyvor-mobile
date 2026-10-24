import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

// B40.16 DONE: with the app open, "Hey Taly" starts listening, and "pause all agents" pauses them after confirmation; a
// payment said aloud is prepared, read back, and waits for Face ID. Porcupine, the microphone and Lens are mocked.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_: string, b: Uint8Array) => Uint8Array.from(jest.requireActual('node:crypto').createHash('sha256').update(b).digest()).buffer,
  randomUUID: () => 'uuid-1',
}))
jest.mock('../config', () => ({
  config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile', picovoiceKey: 'pv-key', heyTalyKeyword: 'hey-taly_ios.ppn' },
}))

/** Porcupine on the phone: `hear()` is the engine recognising the wake phrase in what the microphone picks up. */
const mockWake = { keyword: '', running: false, hear: () => undefined as void }
jest.mock('@picovoice/porcupine-react-native', () => ({
  PorcupineManager: {
    fromKeywordPaths: async (_: string, paths: string[], onWake: () => void) => {
      mockWake.keyword = paths[0]
      mockWake.hear = () => mockWake.running && onWake()
      return { start: async () => void (mockWake.running = true), stop: async () => void (mockWake.running = false), delete: () => undefined }
    },
  },
}))

/** The microphone and the speaker. */
const mockMic = { recording: false, played: [] as string[] }
const mockRecorder = {
  uri: null as string | null,
  prepareToRecordAsync: async () => undefined,
  record: () => {
    mockMic.recording = true
  },
  stop: async () => {
    mockMic.recording = false
    mockRecorder.uri = 'file:///cache/recording.m4a'
  },
}
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: async () => undefined,
  useAudioRecorder: () => mockRecorder,
  createAudioPlayer: (uri: string) => {
    mockMic.played.push(uri)
    return { play: () => undefined, remove: () => undefined }
  },
}))
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`
    }
    async write() {}
  },
}))

/** Face ID: the key signs only once the person has looked at the phone. */
const mockFaceId = { asked: 0, pass: () => undefined as void }
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: () =>
    new Promise<string>((resolve) => {
      mockFaceId.asked++
      mockFaceId.pass = () => resolve('c2lnbmVk')
    }),
  deleteKey: async () => undefined,
}))

/** Lens behind the BFF. `heard` is what transcription answers for the next recording. */
function mockLens(heard: string) {
  const lens = { allPaused: false, spoken: [] as string[], prepared: [] as unknown[], approved: false, asked: [] as unknown[], uploads: 0 }
  const item = { position: 1, payee_id: 'py_acme', payee_name: 'ACME Ltd', currency: 'GBP', amount_minor: 12000, reference: 'ACME invoice', decision: 'needs_approval', reason: 'a payment said aloud' }
  const request = () => ({ id: 'preq_9', status: lens.approved ? 'approved' : 'pending_approval', summary: 'Pay ACME Ltd', client: 'voice', totals: { GBP: 12000 }, items: [item], created_at: '2026-10-24T08:00:00Z' })
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    switch (route) {
      case 'POST /api/chat/voice/transcriptions':
        lens.uploads++
        return json({ text: (body as FormData).get('file') ? heard : '' })
      case 'POST /api/chat/voice/speech':
        lens.spoken.push(body.input)
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
      case 'POST /api/agents/pause-all':
        lens.allPaused = true
        return json({ all_paused: true })
      case 'GET /api/money/payees':
        return json({ payees: [{ id: 'py_acme', name: 'ACME Ltd', country: 'GB', needs_confirmation: false, created_at: '2026-10-01T00:00:00Z' }] })
      case 'POST /api/money/payment-requests':
        lens.prepared.push(body)
        return json(request())
      case 'GET /api/money/payment-requests/preq_9':
        return json(request())
      case 'GET /api/agents': {
        const research = { id: 'ag_research', name: 'Research', balance_ulxc: 4_000_000, spent_ulxc: 1_230_000, created_at: '2026-10-01T00:00:00Z' }
        return json({ workspace_balance_ulxc: 5_230_000, allocated_ulxc: 5_230_000, unallocated_ulxc: 0, spent_ulxc: 1_230_000, agents: [research] })
      }
      case 'GET /api/money/payment-requests?status=pending_approval':
        return json({ requests: [request()] })
      case 'GET /api/money/payments':
        return json({ payments: [] })
      case 'POST /api/money/payment-requests/preq_9/approval': {
        const statement = JSON.stringify({ request_id: 'preq_9', items: [{ position: 1, payee_id: 'py_acme', currency: 'GBP', amount_minor: 12000, reference: 'ACME invoice' }], expires_at: '2099-01-01T00:00:00Z' })
        return json({ statement, challenge: 'ch' })
      }
      case 'POST /api/money/payment-requests/preq_9/approve':
        lens.approved = body.assertion?.device_id === 'dev_1' && body.assertion.signature === 'c2lnbmVk'
        return json(request())
      case 'POST /api/ai/stream/openai/v1/chat/completions':
        lens.asked.push(body)
        return new Response('data: {"choices":[{"delta":{"content":"Your agents spent "}}]}\n\ndata: {"choices":[{"delta":{"content":"12 LXC this week."}}]}\n\ndata: [DONE]\n\n', { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
  }) as unknown as typeof fetch
  return lens
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dev_1')
  mockMic.played = []
  mockRecorder.uri = null
  mockFaceId.asked = 0
})

test('"Hey Taly" with the app open starts listening, and "pause all agents" pauses them only after confirmation', async () => {
  const lens = mockLens('Pause all agents.')
  await renderRouter('./src/app', { initialUrl: '/chat' })

  await fireEvent(await screen.findByLabelText('Listen for Hey Taly'), 'valueChange', true)
  await waitFor(() => expect(mockWake.running).toBe(true))
  expect(mockWake.keyword).toBe('hey-taly_ios.ppn')

  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
  await act(async () => mockWake.hear())
  await waitFor(() => expect(mockMic.recording).toBe(true))
  expect(mockWake.running).toBe(false) // the wake engine lets go of the microphone while Chat listens
  expect(screen.getByText(/^You’re talking to an AI\./)).toBeTruthy()
  await act(async () => void jest.advanceTimersByTime(6000))
  jest.useRealTimers()

  expect(await screen.findByText(CONFIRM_PAUSE)).toBeTruthy()
  expect(lens.uploads).toBe(1)
  await waitFor(() => expect(lens.spoken).toEqual([`You’re talking to an AI. ${CONFIRM_PAUSE}`]))
  expect(lens.allPaused).toBe(false)

  await fireEvent.press(screen.getByText('Yes, pause all'))
  expect(await screen.findByText('Every agent is paused.')).toBeTruthy()
  expect(lens.allPaused).toBe(true)
})

const CONFIRM_PAUSE = 'Pause every agent? Lens refuses each one’s next request or payment until you start them again.'

test('a payment said while holding the microphone is prepared, read back, and waits for Face ID', async () => {
  mockStore.set('talyvor.chat.voice-notice', 'told')
  const lens = mockLens('Pay ACME £120 for the invoice.')
  await renderRouter('./src/app', { initialUrl: '/chat' })

  const mic = await screen.findByLabelText('Hold to talk')
  await fireEvent(mic, 'pressIn')
  await waitFor(() => expect(mockMic.recording).toBe(true))
  await fireEvent(mic, 'pressOut')

  const readBack = 'I’ve prepared a payment of 120.00 GBP to ACME Ltd. Nothing is paid until you approve it with Face ID.'
  expect(await screen.findByText(readBack)).toBeTruthy()
  expect(lens.prepared).toEqual([{ voice: true, items: [{ payee_id: 'py_acme', currency: 'GBP', amount_minor: 12000, reference: 'ACME invoice' }] }])
  await waitFor(() => expect(lens.spoken).toEqual([readBack]))

  await fireEvent.press(screen.getByText('Review and approve with Face ID'))
  await fireEvent.press(await screen.findByText('Approve 1 payment with Face ID'))
  await waitFor(() => expect(mockFaceId.asked).toBe(1))
  expect(lens.approved).toBe(false)
  await act(async () => mockFaceId.pass())
  expect(await screen.findByText('Approved. Each payment you approved is paid once.')).toBeTruthy()
  expect(lens.approved).toBe(true)
})

test('a typed question is asked of the model on "auto" and the answer is shown, not spoken', async () => {
  const lens = mockLens('')
  await renderRouter('./src/app', { initialUrl: '/chat' })

  await fireEvent.changeText(await screen.findByLabelText('Message'), 'What did my agents spend this week?')
  await fireEvent.press(screen.getByText('Send'))
  expect(await screen.findByText('Your agents spent 12 LXC this week.')).toBeTruthy()
  expect(lens.asked).toEqual([{ model: 'auto', stream: true, messages: [{ role: 'user', content: 'What did my agents spend this week?' }] }])
  expect(lens.spoken).toEqual([])
})

test('B41.38: "what’s due this week?" said aloud reads back the payments waiting, and "what did Research spend?" reads its wallet', async () => {
  mockStore.set('talyvor.chat.voice-notice', 'told')
  const lens = mockLens('What’s due this week?')
  const app = await renderRouter('./src/app', { initialUrl: '/chat' })

  const mic = await screen.findByLabelText('Hold to talk')
  await fireEvent(mic, 'pressIn')
  await waitFor(() => expect(mockMic.recording).toBe(true))
  await fireEvent(mic, 'pressOut')
  const due = '1 payment is waiting for your approval: 120.00 GBP to ACME Ltd. Nothing is paid until you approve it with Face ID.'
  expect(await screen.findByText(due)).toBeTruthy()
  await waitFor(() => expect(lens.spoken).toEqual([due]))
  expect(screen.getByText('See what is due')).toBeTruthy()

  await fireEvent.changeText(screen.getByLabelText('Message'), 'What did Research spend?')
  await fireEvent.press(screen.getByText('Send'))
  expect(await screen.findByText('Research has spent 1.23 LXC so far, and holds 4 LXC.')).toBeTruthy()
  expect(lens.asked).toEqual([]) // answered from the wallet, not the model
  expect(lens.prepared).toEqual([])
  await fireEvent.press(screen.getByText('Open Research'))
  await waitFor(() => expect(app.getPathname()).toBe('/agents/ag_research'))
})
