import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B59.29 — the phone's Help and complaints, Close this account and Your data (the web's B59.28, on the phone): each form
// sends one request with its kind and message only, a complaint shows its reference, the list shows each request's state
// and Talyvor's answer, closing is refused naming every balance, and a finished copy of the data reaches the share sheet.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** What was written to the phone and handed to the share sheet. */
const mockFiles: { written: Map<string, Uint8Array>; shared: { uri: string; mimeType?: string }[] } = { written: new Map(), shared: [] }
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string
    exists = false
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`
    }
    create() {}
    delete() {}
    write(bytes: Uint8Array) {
      mockFiles.written.set(this.uri, bytes)
    }
  },
}))
jest.mock('expo-sharing', () => ({
  shareAsync: async (uri: string, o: { mimeType?: string }) => void mockFiles.shared.push({ uri, mimeType: o.mimeType }),
}))

/** The web's strings, typed from suite 4fb65ba (apps/web/src/areas/lens/HelpAndAccount.tsx and PageLinks.tsx): the
 * phone's screens are checked against these, not against their own copy. */
const WEB = {
  settings: [
    'Help and complaints',
    'Ask us something, or make a complaint',
    'Your data',
    'A copy of your data, or ask for it to be deleted',
    'Close this account',
    'What must be empty first, and asking to close',
  ],
  help: [
    'Ask us about your account, or tell us what went wrong. A person at Talyvor reads every message and answers on this page.',
    'A complaint gets a reference as soon as you send it. Quote it whenever you write to us about it.',
    'Write to us',
    'What is it?',
    'A question or a problem',
    'A complaint',
    'Your message',
    'Send',
    'What you sent',
  ],
  close: [
    'Before the account can close, every balance must be empty: the account’s own, each agent’s, and any money set aside. Move the money out first.',
    'A person at Talyvor closes the account and answers on this page. Only the account’s owner can ask.',
    'Ask to close',
    'Anything we should know (optional)',
    'Ask to close this account',
    'What you asked',
    'You have not asked to close this account.',
    'Anything you send appears here with what Talyvor answers.',
  ],
  data: [
    'Ask for a copy of this account’s data, or ask Talyvor to delete it. A person at Talyvor handles each request. Only the account’s owner can ask.',
    'A copy of your data',
    'A person at Talyvor prepares it. When it is ready, Download appears beside your request.',
    'Ask for a copy',
    'Delete your data',
    'Billing and ledger records, statements included, are kept, because the law requires them.',
    'Ask to delete your data',
    'What you asked',
  ],
}

type Req = { id: number; kind: string; state: string; reference: string; message: string; answer: string; filed_at: string; updated_at: string }

/** Lens behind the BFF; `calls` is every request the app made, `requests` what the workspace has sent. */
function mockBff({ requests = [] as Req[], closure }: { requests?: Req[]; closure?: { status: number; body: unknown } } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  let next = 100
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, path, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_northwind' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_northwind', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'business', money_kind: 'fiat' })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/workspace/requests':
        return json({ requests })
      case 'POST /api/workspace/requests': {
        if (body.kind === 'account_closure' && closure) return json(closure.body, closure.status)
        const filed: Req = {
          id: next++,
          kind: body.kind,
          state: 'received',
          reference: body.kind === 'complaint' ? 'C-7KQ2-M4XD' : '',
          message: body.message,
          answer: '',
          filed_at: '2026-11-12T09:00:00Z',
          updated_at: '2026-11-12T09:00:00Z',
        }
        requests.unshift(filed)
        return json(filed, 201)
      }
      case 'GET /api/workspace/requests/7/export':
        return new Response('{"workspace":"ws_northwind"}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return calls
}

const posts = (calls: { method: string; path: string; body?: unknown }[]) => calls.filter((c) => c.method === 'POST' && c.path === '/api/workspace/requests').map((c) => c.body)

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockFiles.written.clear()
  mockFiles.shared.length = 0
})

test("Settings lists the three with the web's words, and each opens its screen", async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/settings' })
  expect(await screen.findByText('Help and your account')).toBeTruthy()
  for (const words of WEB.settings) expect(screen.getByText(words)).toBeTruthy()
  await fireEvent.press(screen.getByText('Your data'))
  expect(await screen.findByText('Ask for a copy')).toBeTruthy()
})

test("Help and complaints shows the web's words, sends a complaint with its kind and message only, and shows its reference", async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/settings/help' })
  expect(await screen.findByText('Nothing sent yet.')).toBeTruthy()
  for (const words of WEB.help) expect(screen.getAllByText(words).length).toBeGreaterThan(0)

  await fireEvent.press(screen.getByRole('radio', { name: 'A complaint' }))
  await fireEvent.changeText(screen.getByLabelText('Your message'), 'My card was charged twice.')
  await fireEvent.press(screen.getByText('Send complaint'))

  expect(await screen.findByText('Complaint received')).toBeTruthy()
  expect(screen.getByText('Its reference is C-7KQ2-M4XD.')).toBeTruthy()
  expect(posts(calls)).toEqual([{ kind: 'complaint', message: 'My card was charged twice.' }])
  const row = await screen.findByTestId('request-100')
  expect(within(row).getByText('Complaint')).toBeTruthy()
  expect(within(row).getByText('C-7KQ2-M4XD')).toBeTruthy()
  expect(within(row).getByText('Received')).toBeTruthy()
})

test('the list shows each request with its state and Talyvor’s answer', async () => {
  mockBff({
    requests: [
      { id: 3, kind: 'support', state: 'done', reference: '', message: 'How do I add a payee?', answer: 'Open Payees and press Add.', filed_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T10:00:00Z' },
      { id: 2, kind: 'complaint', state: 'in_progress', reference: 'C-AB12-CD34', message: 'Late refund.', answer: '', filed_at: '2026-11-10T09:00:00Z', updated_at: '2026-11-11T09:00:00Z' },
    ],
  })
  await renderRouter('./src/app', { initialUrl: '/settings/help' })
  const done = await screen.findByTestId('request-3')
  expect(within(done).getByText('Question or problem')).toBeTruthy()
  expect(within(done).getByText('Done')).toBeTruthy()
  expect(within(done).getByText('Talyvor’s answer:', { exact: false })).toBeTruthy()
  expect(within(done).getByText('Open Payees and press Add.', { exact: false })).toBeTruthy()
  const open = screen.getByTestId('request-2')
  expect(within(open).getByText('In progress')).toBeTruthy()
  expect(within(open).getByText('Sent 10 November 2026', { exact: false })).toBeTruthy()
  expect(within(open).getByText('C-AB12-CD34')).toBeTruthy()
})

test('closing is refused while the account holds money, naming each balance', async () => {
  const calls = mockBff({ closure: { status: 409, body: { error: 'balances are not empty', code: 'balances_not_empty', balances: { GBP: 1250, USDC: 3_000_000 } } } })
  await renderRouter('./src/app', { initialUrl: '/settings/close' })
  expect(await screen.findByText('You have not asked to close this account.')).toBeTruthy()
  for (const words of WEB.close) expect(screen.getAllByText(words).length).toBeGreaterThan(0)

  await fireEvent.press(screen.getByText('Ask to close this account'))
  expect(await screen.findByText('This account still holds £12.50, 3.00 USDC. Move the money out, then ask again.')).toBeTruthy()
  expect(posts(calls)).toEqual([{ kind: 'account_closure', message: '' }])
})

test('Your data asks for a copy and, once done, hands it to the share sheet; deletion is its own request', async () => {
  const calls = mockBff({
    requests: [{ id: 7, kind: 'data_export', state: 'done', reference: '', message: '', answer: '', filed_at: '2026-11-11T09:00:00Z', updated_at: '2026-11-12T08:00:00Z' }],
  })
  await renderRouter('./src/app', { initialUrl: '/settings/data' })
  expect(await screen.findByText('Download your data')).toBeTruthy()
  for (const words of WEB.data) expect(screen.getAllByText(words).length).toBeGreaterThan(0)

  await fireEvent.press(screen.getByText('Download your data'))
  await waitFor(() => expect(mockFiles.shared).toEqual([{ uri: 'file:///cache/talyvor-data.json', mimeType: 'application/json' }]))
  expect(new TextDecoder().decode(mockFiles.written.get('file:///cache/talyvor-data.json'))).toBe('{"workspace":"ws_northwind"}')

  await fireEvent.press(screen.getByText('Ask for a copy'))
  expect(await screen.findByText('When your copy is ready, Download appears on this page.')).toBeTruthy()
  await fireEvent.changeText(screen.getByLabelText('Anything we should know (optional)'), 'Delete everything you can.')
  await fireEvent.press(screen.getByText('Ask to delete your data'))
  expect(await screen.findByText('A person at Talyvor answers on this page.')).toBeTruthy()
  expect(posts(calls)).toEqual([
    { kind: 'data_export', message: '' },
    { kind: 'data_deletion', message: 'Delete everything you can.' },
  ])
})
