import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

import { ACTIVITY_KINDS, filterLines, monthPeriod } from '../activity'

// B59.35 — Settings opens from the top right of Home and shows whose account this is, saves when notices arrive and signs
// out; Activity, from Home and from an agent, filters every movement by period, agent, kind and words, and downloads the
// statement for the period in the file type chosen, with the web's words.

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

const agents = [
  { id: 'ag_1', name: 'Research', balance_ulxc: 5_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
  { id: 'ag_2', name: 'Sales', balance_ulxc: 2_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
]
const line = (posting_id: number, account: string, kind: string, amount_ulxc: number, label: string, at: string) =>
  ({ posting_id, entry_id: `ent_${posting_id}`, at, account, kind, amount_ulxc, counterparty: 'workspace', balance_after_ulxc: 0, label })
const thisMonth = [
  line(1, 'agent:ag_1', 'fund', 3_000_000, 'Funded by you', '2026-11-02T09:00:00Z'),
  line(2, 'agent:ag_1', 'pay', -1_250_000, 'Acme Hosting', '2026-11-03T10:00:00Z'),
  line(3, 'agent:ag_2', 'card', -400_000, 'Northwind Data', '2026-11-04T11:00:00Z'),
]
const lastMonth = [line(9, 'agent:ag_2', 'topup', 9_000_000, 'October top-up', '2026-10-15T08:00:00Z')]

/** Lens behind the BFF; `calls` is every request the app made. */
function mockBff() {
  const calls: { method: string; path: string; query: URLSearchParams; body?: unknown; accept?: string }[] = []
  const settings = { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] as string[] }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path, q = ''] = url.replace('https://bff.test', '').split('?')
    const method = init.method ?? 'GET'
    const query = new URLSearchParams(q)
    const headers = (init.headers ?? {}) as Record<string, string>
    calls.push({ method, path, query, body: init.body ? JSON.parse(init.body as string) : undefined, accept: headers.Accept })
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_northwind' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_northwind', name: 'Northwind Studio' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 7_000_000, allocated_ulxc: 7_000_000, unallocated_ulxc: 0, spent_ulxc: 0, agents })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/accounts':
        return json({ accounts: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/agents/statement':
        if (query.get('format') !== 'json') return new Response('date,amount\n2026-11-02,3.00\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
        return json({ from: query.get('from'), to: query.get('to'), accounts: [], lines: query.get('from') === '2026-10-01' ? lastMonth : thisMonth })
      case 'GET /api/agents/ag_2/statement':
        return new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } })
      case 'GET /api/money/notices':
        return json({ settings, notices: [] })
      case 'PUT /api/money/notices/settings':
        return json(JSON.parse(init.body as string))
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

describe('Settings', () => {
  test('opens from the top right of Home and shows whose account this is', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    await fireEvent.press(await screen.findByLabelText('Settings'))
    expect(await screen.findByText('Profile')).toBeTruthy()
    expect(screen.getAllByText('Northwind Studio').length).toBeGreaterThan(0)
    expect(screen.getByText('ws_northwind')).toBeTruthy()
    expect(screen.getByText('Account ID')).toBeTruthy()
  })

  test('saves when notices arrive', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    expect(await screen.findByText('Notifications')).toBeTruthy()
    await fireEvent(screen.getByLabelText('Monday’s weekly digest'), 'valueChange', false)
    await fireEvent.changeText(screen.getByLabelText('Quiet from'), '22:00')
    await fireEvent.changeText(screen.getByLabelText('Quiet until'), '07:00')
    await fireEvent.press(screen.getByText('Save notice settings'))
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ timezone: 'Europe/London', quiet_from: '22:00', quiet_until: '07:00', off: ['digest'] })
  })

  test('B57.132: draws its own Back, which leads Home when nothing is behind it', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }))
    expect(await screen.findByText('See all in Activity')).toBeTruthy()
  })

  test('signs out of this phone', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    await fireEvent.press(await screen.findByText('Sign out'))
    await waitFor(() => expect(mockStore.has('talyvor.session')).toBe(false))
    expect(await screen.findByText('Sign in')).toBeTruthy()
  })
})

describe('Activity', () => {
  test('opens from Home with every movement this month, newest first', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    await fireEvent.press(await screen.findByText('See all in Activity'))
    expect(await screen.findByText('Northwind Data')).toBeTruthy()
    const shown = screen.getAllByText(/^(Funded by you|Acme Hosting|Northwind Data)$/).map((t) => t.props.children)
    expect(shown).toEqual(['Northwind Data', 'Acme Hosting', 'Funded by you'])
  })

  test('filters by agent, by kind and by words, and reads last month when asked', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/activity' })
    expect(await screen.findByText('Northwind Data')).toBeTruthy()

    await fireEvent.press(within(screen.getByLabelText('Agent')).getByText('Research'))
    expect(screen.queryByText('Northwind Data')).toBeNull()
    expect(screen.getByText('Acme Hosting')).toBeTruthy()

    await fireEvent.press(within(screen.getByLabelText('Kind of line')).getByText('Funded'))
    expect(screen.queryByText('Acme Hosting')).toBeNull()
    expect(screen.getByText('Funded by you')).toBeTruthy()

    await fireEvent.press(within(screen.getByLabelText('Kind of line')).getByText('Every kind'))
    await fireEvent.changeText(screen.getByLabelText('Search'), 'acme')
    expect(screen.queryByText('Funded by you')).toBeNull()
    expect(screen.getByText('Acme Hosting')).toBeTruthy()

    await fireEvent.changeText(screen.getByLabelText('Search'), 'nothing like this')
    expect(screen.getByText('No line matches.')).toBeTruthy()

    await fireEvent.changeText(screen.getByLabelText('Search'), '')
    await fireEvent.press(within(screen.getByLabelText('Agent')).getByText('Every agent'))
    await fireEvent.press(within(screen.getByLabelText('Period')).getByText('Last month'))
    expect(await screen.findByText('October top-up')).toBeTruthy()
    const read = calls.filter((c) => c.path === '/api/agents/statement' && c.query.get('format') === 'json').at(-1)!
    expect([read.query.get('from'), read.query.get('to')]).toEqual(['2026-10-01', '2026-11-01'])
  })

  test('B57.132: each movement reads as Pocket’s statement, its agent then when it moved', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/activity' })
    expect(await screen.findByText('Northwind Data')).toBeTruthy()
    expect(screen.getByText(/^Sales · 4 Nov, \d\d:\d\d$/)).toBeTruthy()
    expect(screen.getByText('This month: November')).toBeTruthy()
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }))
    expect(await screen.findByText('See all in Activity')).toBeTruthy()
  })

  test('an agent’s screen opens its own Activity', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/activity?agent=ag_2' })
    expect(await screen.findByText('Northwind Data')).toBeTruthy()
    expect(screen.queryByText('Acme Hosting')).toBeNull()
  })

  test('downloads the statement for the period in the file type chosen and hands it to the share sheet', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/activity' })
    await fireEvent.press(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => expect(screen.getByText('Saved agent-wallets-statement-2026-11-01-to-2026-11-30.csv.')).toBeTruthy())
    const csv = calls.find((c) => c.query.get('format') === 'csv')!
    expect([csv.path, csv.query.get('from'), csv.query.get('to'), csv.accept]).toEqual(['/api/agents/statement', '2026-11-01', '2026-12-01', 'text/csv'])
    expect(new TextDecoder().decode(mockFiles.written.get('file:///cache/agent-wallets-statement-2026-11-01-to-2026-11-30.csv'))).toBe('date,amount\n2026-11-02,3.00\n')
    expect(mockFiles.shared).toEqual([{ uri: 'file:///cache/agent-wallets-statement-2026-11-01-to-2026-11-30.csv', mimeType: 'text/csv' }])

    // One agent's statement, as a PDF.
    await fireEvent.press(within(screen.getByLabelText('Agent')).getByText('Sales'))
    await fireEvent.press(within(screen.getByLabelText('File type of Sales’s statement')).getByText('PDF'))
    await fireEvent.press(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(screen.getByText('Saved sales-statement-2026-11-01-to-2026-11-30.pdf.')).toBeTruthy())
    expect(calls.find((c) => c.query.get('format') === 'pdf')?.path).toBe('/api/agents/ag_2/statement')
    expect(mockFiles.shared.at(-1)).toEqual({ uri: 'file:///cache/sales-statement-2026-11-01-to-2026-11-30.pdf', mimeType: 'application/pdf' })
  })

  test('the filters and the Download line read as the web’s', () => {
    // The web's words (talyvor-suite apps/web/src/areas/lens/AgentBank.tsx: STATEMENT_KINDS and StatementDownload), less
    // the kinds in areas the launch pack hides: Escrow, Pots, Cash-outs and Credit line.
    expect(ACTIVITY_KINDS.map((k) => k.label)).toEqual(['Every kind', 'Funded', 'Taken back', 'Top-ups', 'Requests', 'Platform fees', 'Payments', 'Transfers', 'Card'])
    expect(monthPeriod('last', new Date('2026-01-20T00:00:00Z'))).toEqual({ from: '2025-12-01', to: '2026-01-01' })
    expect(filterLines(thisMonth, { agent: null, kinds: ['pay', 'card'], q: '' }).map((l) => l.posting_id)).toEqual([3, 2])
  })

  test('the Download line is the web’s', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/activity' })
    expect(
      await screen.findByText(
        'Download every agent’s statement for a period: the opening balance, every movement with its posting and entry, and the closing balance. Days are UTC; the last day is included. The journal imports into Xero or QuickBooks: each entry one balanced journal, each agent its cost centre.',
      ),
    ).toBeTruthy()
    for (const words of ['This month', 'Last month', 'CSV', 'JSON', 'PDF', 'Journal for Xero or QuickBooks', 'Download']) expect(screen.getAllByText(words).length).toBeGreaterThan(0)
  })
})
