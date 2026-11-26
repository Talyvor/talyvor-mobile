import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B61.135 — Activity › Statements (pocket-live DESIGN.md 16.2): one balance's statement as paper, its first 4 lines and
// See all, Statement for and Period as sheets of radio rows, and Download statement handing Lens's PDF, Excel sheet or
// CSV to the share sheet with its own mime type and 16.1's file name.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))

/** What was written to the phone and handed to the share sheet. */
const mockFiles: { written: Map<string, Uint8Array>; shared: { uri: string; mimeType?: string; dialogTitle?: string }[] } = { written: new Map(), shared: [] }
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
  shareAsync: async (uri: string, o: { mimeType?: string; dialogTitle?: string }) => void mockFiles.shared.push({ uri, mimeType: o.mimeType, dialogTitle: o.dialogTitle }),
}))

const accounts = [
  { id: 'macc_usd', currency: 'USD', purpose: 'company', status: 'active', name: '', balance_minor: 1810149, test_minor: 0, live_minor: 1810149 },
  { id: 'macc_eur', currency: 'EUR', purpose: 'company', status: 'active', name: '', balance_minor: 50000, test_minor: 0, live_minor: 50000 },
  { id: 'macc_atlas', agent_id: 'ag_1', currency: 'USD', purpose: 'agent', status: 'active', name: '', balance_minor: 12000, test_minor: 0, live_minor: 12000 },
]
const line = (n: number, kind: string, amount: number, counterparty: string, extra = {}) => ({
  entry_id: `ent_${n}`,
  line: 1,
  at: `2026-11-0${n}T10:4${n}:00Z`,
  kind,
  amount_minor: amount,
  counterparty,
  state: 'completed',
  balance_after_minor: 0,
  ...extra,
})
const usdLines = [
  line(2, 'invoice_payment', 900000, 'Northwind Ltd', { partner_ref: 'INV-2034' }),
  line(3, 'card_charge', -4200, 'Figma', { task: 'A design seat' }),
  line(4, 'payment_out', -50000, 'Acme Supplies', { state: 'pending' }),
  line(5, 'card_charge', -1900, 'macc_atlas'),
  line(6, 'payment_in', 20000, 'workspace:ws_other'),
  line(7, 'card_refund', 1900, 'Figma'),
]

/** Lens behind the BFF; `calls` is every request the app made. */
function mockBff() {
  const calls: { path: string; query: URLSearchParams; accept?: string }[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path, q = ''] = url.replace('https://bff.test', '').split('?')
    const query = new URLSearchParams(q)
    calls.push({ path, query, accept: ((init.headers ?? {}) as Record<string, string>).Accept })
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    if (path === '/auth/me') return json({ workspace_id: 'ws_northwind' })
    if (path === '/api/workspace/areas') return json({ areas: [] })
    if (path === '/api/money/accounts') return json({ accounts })
    if (path === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_1', name: 'Atlas', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] })
    const st = path.match(/^\/api\/money\/accounts\/(\w+)\/statement$/)
    if (st) {
      const format = query.get('format')
      if (format) return new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 })
      const usd = st[1] === 'macc_usd'
      return json({
        account_id: st[1],
        currency: usd ? 'USD' : 'EUR',
        from: `${query.get('from')}T00:00:00Z`,
        to: `${query.get('to')}T00:00:00Z`,
        opening_minor: usd ? 1331597 : 50000,
        in_minor: usd ? 921900 : 0,
        out_minor: usd ? 56100 : 0,
        closing_minor: usd ? 2197397 : 50000,
        lines: usd ? usdLines : [],
      })
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-26T12:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'nextTick'] })
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockFiles.written.clear()
  mockFiles.shared.length = 0
})
afterEach(() => jest.useRealTimers())

test('with Excel chosen the button reads Download Excel, and the share gets the xlsx mime type and a name ending .xlsx', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/activity?tab=statements' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Download statement' }))
  const sheet = await screen.findByTestId('statement-download')
  expect(within(sheet).getByRole('button', { name: 'Download PDF' })).toBeTruthy()
  await fireEvent.press(within(sheet).getByRole('radio', { name: 'Excel. A sheet with totals that add up' }))
  await fireEvent.press(within(sheet).getByRole('button', { name: 'Download Excel' }))
  await waitFor(() => expect(mockFiles.shared).toHaveLength(1))
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  expect(mockFiles.shared[0]).toEqual({ uri: 'file:///cache/talyvor-statement-USD-2026-11.xlsx', mimeType: xlsx, dialogTitle: 'talyvor-statement-USD-2026-11.xlsx' })
  const file = calls.find((c) => c.query.get('format') === 'xlsx')!
  expect([file.path, file.query.get('from'), file.query.get('to'), file.accept]).toEqual(['/api/money/accounts/macc_usd/statement', '2026-11-01', '2026-11-27', xlsx])
  expect(mockFiles.written.get('file:///cache/talyvor-statement-USD-2026-11.xlsx')).toEqual(new Uint8Array([80, 75, 3, 4]))
})

test('the paper shows the four figures, the first 4 lines in words, and See all pushes the whole statement', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/activity?tab=statements' })
  const paper = await screen.findByTestId('statement-paper')
  expect(within(paper).getByText('November so far')).toBeTruthy()
  expect(within(paper).getByText('US dollar balance · 1 to 26 November 2026')).toBeTruthy()
  for (const f of ['Opening balance $13,315.97', 'Money in $9,219.00', 'Money out $561.00', 'Balance now $21,973.97']) expect(within(paper).getByLabelText(f)).toBeTruthy()
  expect(within(paper).getAllByTestId('statement-line')).toHaveLength(4)
  expect(within(paper).getByText('Invoice paid · 10:42')).toBeTruthy()
  expect(within(paper).getByText('The agent says: A design seat')).toBeTruthy()
  expect(within(paper).getByText('Pending')).toBeTruthy()
  expect(within(paper).getByText('Atlas')).toBeTruthy()
  expect(within(paper).queryByText(/card_charge|payment_out|test money/)).toBeNull()
  await fireEvent.press(within(paper).getByRole('button', { name: 'See all 6 lines' }))
  await waitFor(() => expect(screen).toHavePathname('/statements'))
  const whole = await screen.findByTestId('statement-paper')
  await waitFor(() => expect(within(whole).getAllByTestId('statement-line')).toHaveLength(6))
  expect(within(whole).getByTestId('statement-adds-up').props.children).toEqual(['$13,315.97 opening + $9,219.00 in − $561.00 out = ', expect.anything()])
  expect(screen.getByRole('button', { name: 'Download statement' })).toBeTruthy()
})

test('Statement for and Period redraw the paper for the euro balance in October', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/activity?tab=statements' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Statement for, US dollar balance' }))
  await fireEvent.press(within(await screen.findByTestId('statement-for')).getByRole('radio', { name: 'Euro balance. Holds €500.00' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Period, November so far' }))
  await fireEvent.press(within(await screen.findByTestId('statement-period')).getByRole('radio', { name: 'October 2026. 1 to 31 October 2026' }))
  const paper = await screen.findByTestId('statement-paper')
  await waitFor(() => expect(within(paper).getByText('Euro balance · 1 to 31 October 2026')).toBeTruthy())
  expect(within(paper).getByText('Nothing moved in this period.')).toBeTruthy()
  expect(within(paper).getByLabelText('Closing balance €500.00')).toBeTruthy()
  const read = calls.filter((c) => c.path === '/api/money/accounts/macc_eur/statement').at(-1)!
  expect([read.query.get('from'), read.query.get('to')]).toEqual(['2026-10-01', '2026-11-01'])
})
