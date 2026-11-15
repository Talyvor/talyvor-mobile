import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { Linking } from 'react-native'

// B61.39 — the phone's Help chat, the web's B61.38 on the phone's own screen, through the same BFF routes: Settings,
// Help opens it; a question goes to /api/help/ask with the page it was asked from, and the reply shows who wrote it
// and the screen that answers it; "I don't know that" offers "Send to our team", which files the chat in the help
// inbox and opens the phone's mail app to Talyvor with the question filled in; past the day's questions the BFF's
// sentence is shown and the team is still one press away.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

type Msg = { by: string; text: string; page?: string; team?: boolean; topic?: string; at: string }
type Reply = { status: number; body: unknown }

/** The BFF's Help routes; `reply` answers each question with the chat so far. */
function mockBff(reply: (q: string, chat: Msg[]) => Reply) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const chat: Msg[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, path, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_maya' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_maya', name: 'Maya Lind' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'personal', money_kind: 'fiat' })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/help/chat':
        return json({ messages: chat, kept_days: 30 })
      case 'POST /api/help/ask': {
        const r = reply(body.question, chat)
        return json(r.body, r.status)
      }
      case 'POST /api/help/team':
        return json({ id: 9, kind: 'support', state: 'received', reference: '', message: 'From the Help chat.', answer: '', filed_at: '', updated_at: '' }, 201)
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return calls
}

const at = '2026-11-15T21:00:00Z'
const answered = (q: string, chat: Msg[], a: Omit<Msg, 'at'>): Reply => {
  chat.push({ by: 'you', text: q, at }, { ...a, at })
  return { status: 200, body: { messages: [...chat] } }
}

let openURL: jest.SpyInstance
beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
})
afterEach(() => openURL.mockRestore())

test('Settings, Help opens the chat; an answer shows who wrote it and opens the screen that answers it', async () => {
  const calls = mockBff((q, chat) =>
    answered(q, chat, { by: 'ai', text: 'Each agent has rules you set. A payment outside them waits for your yes.', page: '/approvals' }),
  )
  await renderRouter('./src/app', { initialUrl: '/settings' })
  await fireEvent.press(await screen.findByText('Ask anything, any time'))
  expect(await screen.findByText('Ask us anything about Talyvor.')).toBeTruthy()
  expect(screen.getByText('Answers are written by AI.')).toBeTruthy()

  await fireEvent.press(await screen.findByText('How do approvals work?'))
  const ai = await screen.findByTestId('help-ai')
  expect(within(ai).getByText('Talyvor AI')).toBeTruthy()
  expect(within(ai).getByText('Each agent has rules you set. A payment outside them waits for your yes.')).toBeTruthy()
  expect(within(screen.getByTestId('help-you')).getByText('How do approvals work?')).toBeTruthy()
  expect(calls.filter((c) => c.path === '/api/help/ask').map((c) => c.body)).toEqual([{ question: 'How do approvals work?', page: '/settings' }])
  expect(screen.queryByText('Send to our team')).toBeNull()

  await fireEvent.press(within(ai).getByText('Open Approvals'))
  await waitFor(() => expect(screen.queryByText('Ask us anything about Talyvor.')).toBeNull())
})

test('"I don\'t know that" offers Send to our team, which files the chat and opens mail to Talyvor with the question', async () => {
  const calls = mockBff((q, chat) => answered(q, chat, { by: 'ai', text: "I don't know that. Our team can answer it.", team: true }))
  await renderRouter('./src/app', { initialUrl: '/help' })
  await fireEvent.changeText(await screen.findByLabelText('Your question'), 'Can my agent pay in yen?')
  await fireEvent.press(screen.getByText('Ask'))
  expect(await screen.findByText("I don't know that. Our team can answer it.")).toBeTruthy()
  expect(screen.getByText('We answer by email.')).toBeTruthy()

  await fireEvent.press(screen.getByText('Send to our team'))
  expect(await screen.findByText('Sent to our team. We answer by email.')).toBeTruthy()
  expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/help/team')).toHaveLength(1)
  expect(openURL).toHaveBeenCalledWith('mailto:hello@talyvor.com?subject=Help%20with%20Talyvor&body=Can%20my%20agent%20pay%20in%20yen%3F')
  expect(screen.queryByText('Send to our team')).toBeNull()
})

test("past the day's questions the BFF's sentence is shown and the team is still one press away", async () => {
  const sentence = 'You have asked 20 questions today, the most for one day. Ask again tomorrow, or send this to our team.'
  mockBff((q, chat) => ({ status: 429, body: { error: sentence, messages: [...chat, { by: 'you', text: q, at }] } }))
  await renderRouter('./src/app', { initialUrl: '/help' })
  await fireEvent.changeText(await screen.findByLabelText('Your question'), 'One more?')
  await fireEvent.press(screen.getByText('Ask'))
  expect(await screen.findByText(sentence)).toBeTruthy()
  expect(within(screen.getByTestId('help-you')).getByText('One more?')).toBeTruthy()
  expect(screen.getByText('Send to our team')).toBeTruthy()
})
