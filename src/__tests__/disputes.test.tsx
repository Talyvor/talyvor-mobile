import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

// B59.26 — disputes and refunds on the phone (the web's B59.25): a card payment is disputed from its line with a reason
// and then says where its dispute stands; each state in the web's words; refunds shown on the screen and under the
// agent's card; and Export handing the card payments of a date range, Lens's CSV, to the share sheet.

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

// The web's own words, as apps/web/src/areas/lens/CardDisputes.tsx and AccountStatement.tsx in talyvor-suite show them
// (B59.25, e1edd6e8).
const WEB = {
  dispute: 'Dispute this payment',
  why: 'Why are you disputing it?',
  issuerDecides: 'The card issuer decides. If you win, the payment comes back to this account.',
  send: 'Send dispute',
  whyFirst: 'Say why you are disputing it first.',
  sent: 'Dispute sent to the card issuer',
  opened: 'Dispute opened',
  withIssuer: 'With the card issuer',
  won: (back: string) => `Dispute won · ${back} back`,
  lost: 'Dispute lost',
  title: 'Disputes and refunds',
  refund: 'Refund',
  cardPayment: 'Card payment',
  from: 'Card payments from',
  to: 'To',
  export: 'Export',
  range: 'Choose a first day on or before the last.',
  exported: (from: string, to: string) => `Downloading card payments from ${from} to ${to} as a CSV file`,
}

const agents = [{ id: 'ag_1', name: 'Research', colour: 'cobalt', balance_ulxc: 5_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }]
const rules = { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '' }
const charge = (n: number, ref: string, merchant: string, minor: number, at: string) => ({
  entry_id: `ent_${n}`,
  line: 1,
  at,
  kind: 'card_charge',
  amount_minor: -minor,
  counterparty: merchant,
  partner_ref: ref,
  balance_after_minor: 0,
})
const dispute = (id: string, payment: string, merchant: string, status: string, credited = 0) => ({
  id,
  payment_id: payment,
  agent_id: 'ag_1',
  card_id: 'mc_1',
  merchant,
  amount_minor: 3_000,
  currency: 'GBP',
  reason: 'Never arrived',
  status,
  credited_minor: credited,
  created_at: '2026-11-09T09:00:00Z',
})

/** Lens behind the BFF: Research's pound account has four card payments, three of them disputed, and one refund. */
function mockBff() {
  const calls: { method: string; path: string; query: URLSearchParams; body?: unknown }[] = []
  const disputes = [dispute('dsp_2', 'pay_2', 'Hotel', 'with_issuer'), dispute('dsp_3', 'pay_3', 'Airline', 'won', 3_000), dispute('dsp_4', 'pay_4', 'Shop', 'lost')]
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path, q = ''] = url.replace('https://bff.test', '').split('?')
    const method = init.method ?? 'GET'
    const query = new URLSearchParams(q)
    calls.push({ method, path, query, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 5_000_000, allocated_ulxc: 5_000_000, unallocated_ulxc: 0, spent_ulxc: 0, agents })
      case 'GET /api/agents/ag_1/rules':
        return json(rules)
      case 'GET /api/agents/ag_1/card':
        return json({ card: { id: 'ic_1', agent_id: 'ag_1', last4: '4242', exp_month: 9, exp_year: 2028, currency: 'gbp', livemode: false, created_at: '2026-11-01T00:00:00Z' }, authorizations: [] })
      case 'GET /api/money/accounts':
        return json({ accounts: [{ id: 'macc_1', agent_id: 'ag_1', currency: 'GBP', purpose: 'agent', status: 'active', name: 'Research pounds', balance_minor: 50_000 }] })
      case 'GET /api/money/accounts/macc_1/statement':
        return json({
          account_id: 'macc_1',
          currency: 'GBP',
          from: query.get('from'),
          to: query.get('to'),
          lines: [
            charge(1, 'pay_1', 'Bookshop', 2_450, '2026-11-10T09:00:00Z'),
            charge(2, 'pay_2', 'Hotel', 3_000, '2026-11-09T09:00:00Z'),
            charge(3, 'pay_3', 'Airline', 3_000, '2026-11-08T09:00:00Z'),
            charge(4, 'pay_4', 'Shop', 3_000, '2026-11-07T09:00:00Z'),
            { entry_id: 'ent_5', line: 1, at: '2026-11-06T09:00:00Z', kind: 'payment_in', amount_minor: 10_000, counterparty: 'Acme', balance_after_minor: 0 },
          ],
        })
      case 'GET /api/money/card-disputes':
        return json({ card_disputes: disputes })
      case 'POST /api/money/card-disputes': {
        const d = dispute('dsp_1', 'pay_1', 'Bookshop', 'opened')
        disputes.unshift(d)
        return json(d, 201)
      }
      case 'GET /api/money/card-refunds':
        return json({ card_refunds: [{ id: 'rf_1', payment_id: 'pay_5', agent_id: 'ag_1', card_id: 'mc_1', merchant: 'Cafe', amount_minor: 450, currency: 'GBP', credited_minor: 450, created_at: '2026-11-10T08:00:00Z' }] })
      case 'GET /api/money/card-exports':
        return new Response('date,kind,amount\n2026-11-10,card_charge,-24.50\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
    }
    return json({ error: 'not found' }, 404)
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

test('the phone’s words are the web’s', () => {
  const { DISPUTE_WORDS: W, wonText, exportedText } = jest.requireActual('../dispute-words')
  for (const k of ['dispute', 'why', 'issuerDecides', 'send', 'whyFirst', 'sent', 'opened', 'withIssuer', 'lost', 'title', 'refund', 'cardPayment', 'from', 'to', 'export', 'range'] as const) {
    expect([k, W[k]]).toEqual([k, WEB[k]])
  }
  expect(wonText('£30.00')).toBe(WEB.won('£30.00'))
  expect(exportedText('2026-11-01', '2026-11-11')).toBe(WEB.exported('2026-11-01', '2026-11-11'))
})

test('Cards opens Disputes and refunds, and each card lists its own', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  expect(await screen.findByRole('button', { name: WEB.title })).toBeTruthy()
  // Under Research's card: its three disputes and its refund.
  expect(await screen.findAllByTestId('card-dispute')).toHaveLength(3)
  expect(screen.getAllByTestId('card-refund')).toHaveLength(1)
  await fireEvent.press(screen.getByRole('button', { name: WEB.title }))
  await waitFor(() => expect(screen).toHavePathname('/disputes'))
})

test('a card payment is disputed with a reason, and then says where its dispute stands', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/disputes' })
  expect(await screen.findAllByTestId('card-payment')).toHaveLength(4)
  // Only the undisputed payment offers a dispute; a payment in is no card payment.
  expect(screen.getAllByText(WEB.dispute)).toHaveLength(1)
  expect(screen.queryByText('Acme')).toBeNull()

  await fireEvent.press(screen.getByText(WEB.dispute))
  expect(screen.getByLabelText(WEB.why)).toBeTruthy()
  expect(screen.getByText(WEB.issuerDecides)).toBeTruthy()
  // Nothing is sent without a reason.
  expect(screen.getByText(WEB.whyFirst)).toBeTruthy()
  await fireEvent.press(screen.getByText(WEB.send))
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)

  await fireEvent.changeText(screen.getByLabelText(WEB.why), '  Charged twice  ')
  await fireEvent.press(screen.getByText(WEB.send))
  expect(await screen.findByText(WEB.sent)).toBeTruthy()
  expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toEqual([['/api/money/card-disputes', { payment_id: 'pay_1', reason: 'Charged twice' }]])
  expect(screen.queryByText(WEB.dispute)).toBeNull()
  expect(screen.getAllByText(WEB.opened).length).toBeGreaterThan(0)
})

test('each state reads in the web’s words, and a refund comes back as money in', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/disputes' })
  await screen.findAllByTestId('card-payment')
  const read = calls.find((c) => c.path === '/api/money/accounts/macc_1/statement')!
  expect([read.query.get('from'), read.query.get('to')]).toEqual(['2026-11-01', '2026-12-01'])
  // On its payment's line and again in the list of disputes.
  expect(screen.getAllByText(WEB.withIssuer)).toHaveLength(2)
  expect(screen.getAllByText(WEB.won('£30.00'))).toHaveLength(2)
  expect(screen.getAllByText(WEB.lost)).toHaveLength(2)
  expect(screen.getByText(/^Refund · /)).toBeTruthy()
  expect(screen.getByText('+£4.50')).toBeTruthy()
  expect(screen.getByText('Cafe')).toBeTruthy()
})

test('Export hands this month so far, or the days chosen, to the share sheet as Lens’s CSV', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/disputes' })
  expect(await screen.findByLabelText(WEB.from)).toBeTruthy()
  expect(screen.getByLabelText(WEB.from).props.value).toBe('2026-11-01')
  expect(screen.getByLabelText(WEB.to).props.value).toBe('2026-11-11')

  // A last day before the first exports nothing.
  await fireEvent.changeText(screen.getByLabelText(WEB.to), '2026-10-31')
  expect(screen.getByText(WEB.range)).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: WEB.export }))
  expect(calls.filter((c) => c.path === '/api/money/card-exports')).toHaveLength(0)

  await fireEvent.changeText(screen.getByLabelText(WEB.to), '2026-11-10')
  await fireEvent.press(screen.getByRole('button', { name: WEB.export }))
  expect(await screen.findByText(WEB.exported('2026-11-01', '2026-11-10'))).toBeTruthy()
  const got = calls.filter((c) => c.path === '/api/money/card-exports')
  expect(got.map((c) => [c.query.get('from'), c.query.get('to')])).toEqual([['2026-11-01', '2026-11-10']])
  expect(mockFiles.shared).toEqual([{ uri: 'file:///cache/card-payments-2026-11-01-to-2026-11-10.csv', mimeType: 'text/csv' }])
  expect(new TextDecoder().decode(mockFiles.written.get('file:///cache/card-payments-2026-11-01-to-2026-11-10.csv'))).toContain('card_charge')
})
