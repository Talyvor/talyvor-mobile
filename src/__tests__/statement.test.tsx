import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

// B57.73 — the Statement tab as Pocket draws it (p-statement): this month by name, each wallet now dollars first and to
// its agent, every movement newest first by model and day as Lens reads them (B57.13), each model's platform fee the
// line under it, and Download CSV handing the month's statement to the share sheet.

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

const lxc = (n: number) => Math.round(n * 1_000_000)
const agents = [
  { id: 'ag_1', name: 'Research', balance_ulxc: lxc(16_500), spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
  { id: 'ag_2', name: 'Sales', balance_ulxc: lxc(12_000), spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
]
const base = { counterparty: 'workspace', balance_after_ulxc: 0 }
/** Lens's lines read by day, newest first: a model's day, its fee the line under it. */
const byDay = [
  { ...base, posting_id: 9, entry_id: 'ent_9', at: '2026-11-11T10:31:00Z', account: 'agent:ag_1', kind: 'fund', amount_ulxc: lxc(1_000) },
  { ...base, posting_id: 8, entry_id: 'ent_8', at: '2026-11-11T10:24:00Z', account: 'agent:ag_1', kind: 'spend', amount_ulxc: -lxc(420), model: 'claude-sonnet-5', day: '2026-11-11', requests: 312 },
  { ...base, posting_id: 7, entry_id: 'ent_7', at: '2026-11-11T10:24:00Z', account: 'agent:ag_1', kind: 'platform_fee', amount_ulxc: -lxc(23.1), model: 'claude-sonnet-5', day: '2026-11-11', requests: 0, label: 'Platform fee 5.5%', memo: 'On those requests' },
  { ...base, posting_id: 5, entry_id: 'ent_5', at: '2026-11-10T09:52:00Z', account: 'agent:ag_2', kind: 'spend', amount_ulxc: -lxc(120), model: 'claude-haiku-4-5', day: '2026-11-10', requests: 410 },
]

/** Lens behind the BFF; `calls` is every request the app made. */
function mockBff() {
  const calls: { method: string; path: string; query: URLSearchParams; accept?: string }[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path, q = ''] = url.replace('https://bff.test', '').split('?')
    const method = init.method ?? 'GET'
    const query = new URLSearchParams(q)
    calls.push({ method, path, query, accept: ((init.headers ?? {}) as Record<string, string>).Accept })
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_northwind' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/lxc/topup-options':
        return json({ usd_per_lxc: 0.1, min_usd_cents: 1000 })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: lxc(28_500), allocated_ulxc: lxc(28_500), unallocated_ulxc: 0, spent_ulxc: 0, agents })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/models':
        return json([{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }])
      case 'GET /api/agents/statement':
        if (query.get('format') === 'csv') return new Response('date,amount\n2026-11-11,100.00\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
        return json({
          from: query.get('from'),
          to: query.get('to'),
          accounts: [
            { account: 'agent:ag_1', opening_ulxc: lxc(15_943.1), in_ulxc: lxc(1_000), out_ulxc: lxc(443.1), closing_ulxc: lxc(16_500) },
            { account: 'agent:ag_2', opening_ulxc: lxc(12_120), in_ulxc: 0, out_ulxc: lxc(120), closing_ulxc: lxc(12_000) },
          ],
          lines: query.get('group') === 'day' ? byDay : [],
          ...(query.get('group') === 'day' ? { group: 'day', time_zone: 'UTC' } : {}),
        })
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-11T12:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'nextTick'] })
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockFiles.written.clear()
  mockFiles.shared.length = 0
})
afterEach(() => jest.useRealTimers())

test('every movement reads by model and day, newest first, each model’s platform fee the line under it', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/statement' })
  expect(await screen.findByText('Claude Sonnet 5')).toBeTruthy()
  expect(screen.getByText('This month: November')).toBeTruthy()
  const read = calls.find((c) => c.path === '/api/agents/statement' && c.query.get('format') === 'json')!
  expect([read.query.get('from'), read.query.get('to'), read.query.get('group')]).toEqual(['2026-11-01', '2026-12-01', 'day'])

  const titles = ['Funded by the workspace', 'Claude Sonnet 5', 'Platform fee 5.5%', 'claude-haiku-4-5']
  const rows = screen.getAllByText(new RegExp(`^(${titles.join('|')})$`)).map((t) => t.props.children)
  expect(rows).toEqual(titles)
  expect(screen.getByText(/^Research · Today, \d\d:\d\d · Settled$/)).toBeTruthy()
  expect(screen.getByText(/^Research · Today, \d\d:\d\d · 312 requests today$/)).toBeTruthy()
  expect(screen.getByText(/^Research · Today, \d\d:\d\d · On those requests$/)).toBeTruthy()
  expect(screen.getByText(/^Sales · Yesterday, \d\d:\d\d · 410 requests$/)).toBeTruthy()
})

test('each wallet now shows its balance dollars first and opens its agent, as each movement does', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/statement' })
  expect(await screen.findByText('Each wallet now')).toBeTruthy()
  expect(screen.getByLabelText('$1,650.00 (16,500 LXC)')).toBeTruthy()
  expect(screen.getByLabelText('$1,200.00 (12,000 LXC)')).toBeTruthy()

  await fireEvent.press(screen.getByRole('button', { name: /^Sales/ }))
  await waitFor(() => expect(screen).toHavePathname('/agents/ag_2'))

  await renderRouter('./src/app', { initialUrl: '/statement' })
  await fireEvent.press(await screen.findByRole('button', { name: /^claude-haiku-4-5/ }))
  await waitFor(() => expect(screen).toHavePathname('/agents/ag_2'))
})

test('Download CSV hands the month’s statement, Lens’s CSV, to the share sheet', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/statement' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Download CSV' }))
  await waitFor(() => expect(screen.getByText('Saved agent-wallets-statement-2026-11-01-to-2026-11-30.csv.')).toBeTruthy())
  const csv = calls.find((c) => c.query.get('format') === 'csv')!
  expect([csv.path, csv.query.get('from'), csv.query.get('to'), csv.accept]).toEqual(['/api/agents/statement', '2026-11-01', '2026-12-01', 'text/csv'])
  expect(new TextDecoder().decode(mockFiles.written.get('file:///cache/agent-wallets-statement-2026-11-01-to-2026-11-30.csv'))).toBe('date,amount\n2026-11-11,100.00\n')
  expect(mockFiles.shared).toEqual([{ uri: 'file:///cache/agent-wallets-statement-2026-11-01-to-2026-11-30.csv', mimeType: 'text/csv' }])
})
