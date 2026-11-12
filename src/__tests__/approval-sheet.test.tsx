import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B57.67: deciding on the phone is Pocket's approval sheet (p-home+psheet-A, psheet-L) over the screen you are on, then
// its result screen (p-approved-acme, p-declined-acme): what pays it, the budget left, when it expires, Face ID, Next.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
const mockPhone = { reasons: [] as string[] }
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_: string, message: string, reason: string) => {
    mockPhone.reasons.push(reason)
    return `signed:${message}`
  },
  deleteKey: async () => undefined,
}))

/** Tomorrow at 09:17 on this machine's clock, as Lens writes a time. */
const tomorrowAt = (h: number, m: number) => {
  const t = new Date()
  t.setDate(t.getDate() + 1)
  t.setHours(h, m, 0, 0)
  return t.toISOString()
}

const acme = {
  id: 'apr_acme',
  agent_id: 'ag_research',
  amount_ulxc: 3_400_000_000,
  model: '',
  reason: 'October hosting invoice',
  payee: { kind: 'outside', id: 'py_acme', name: 'Acme Hosting' },
  status: 'pending',
  created_at: '2026-10-22T08:17:00Z',
  expires_at: tomorrowAt(9, 17),
  paid_from: { kind: 'account', account_id: 'acc_usd', name: 'Research’s US dollar account', currency: 'USD', amount_minor: 34_000, balance_minor: 40_000 },
  asks_above_ulxc: 2_500_000_000,
  budget_left_after_ulxc: 4_200_000_000,
}
const lead = {
  id: 'apr_lead',
  agent_id: 'ag_sales',
  amount_ulxc: 900_000_000,
  model: '',
  payee: { kind: 'listing', id: 'lst_lead', name: 'Lead finder' },
  memo: 'One use of Lead finder (version 3)',
  status: 'pending',
  created_at: '2026-10-22T07:41:00Z',
  expires_at: tomorrowAt(8, 41),
  paid_from: { kind: 'marketplace_bill', account_id: '', name: 'Your monthly marketplace bill', currency: 'USD', amount_minor: 9_000, balance_minor: null },
  asks_above_ulxc: 500_000_000,
  budget_left_after_ulxc: 3_100_000_000,
}

/** The BFF: two agents, Acme Hosting's payment and Lead finder's use waiting, Sandbox labels, $0.10 an LXC. */
function mockBff() {
  const calls: { method: string; path: string; body?: string }[] = []
  const status: Record<string, string> = { apr_acme: 'pending', apr_lead: 'pending' }
  const rules = (monthly: number) => ({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: monthly, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'UTC' })
  const routes: Partial<Record<string, (body?: string) => unknown>> = {
    'GET /auth/me': () => ({ workspace_id: 'ws_1' }),
    'GET /api/lxc/topup-options': () => ({ usd_per_lxc: 0.1, min_usd_cents: 1000 }),
    'GET /api/money/accounts': () => ({ accounts: [] }),
    'GET /api/agents': () => ({
      workspace_balance_ulxc: 0,
      allocated_ulxc: 0,
      unallocated_ulxc: 0,
      spent_ulxc: 0,
      agents: [
        { id: 'ag_research', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
        { id: 'ag_sales', name: 'Sales', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
      ],
    }),
    'GET /api/agents/approvals': () => ({ approvals: [acme, lead].map((a) => ({ ...a, status: status[a.id] })) }),
    'GET /api/agents/ag_research/rules': () => rules(20_000_000_000),
    'GET /api/agents/ag_sales/rules': () => rules(15_000_000_000),
    'GET /api/wallets/capabilities': () => ({
      capabilities: ['spend_on_talyvor', 'move_between_own_agents', 'buy_marketplace_listings', 'payments_out', 'pay_another_owner'].map((capability) => ({ capability, name: capability, class: 'GREEN', real_money: false, label: 'sandbox' })),
    }),
    'GET /api/money/payment-requests': () => ({ requests: [] }),
    'GET /api/agents/keys/enrolments': () => ({ enrolments: [] }),
    ...Object.fromEntries(
      ['apr_acme', 'apr_lead'].flatMap((id) => [
        [`POST /api/agents/approvals/${id}/challenge`, () => ({ challenge: `ch_${id}` })],
        [`POST /api/agents/approvals/${id}/approve`, () => ((status[id] = 'approved'), {})],
        [`POST /api/agents/approvals/${id}/deny`, () => ((status[id] = 'denied'), {})],
      ]),
    ),
  }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: init.body as string | undefined })
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`]
    return new Response(JSON.stringify(route ? route(init.body as string | undefined) : { error: 'no' }), { status: route ? 200 : 404 })
  }) as unknown as typeof fetch
  return { calls, status }
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dk_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
  mockPhone.reasons = []
})

const sheet = () => within(screen.getByTestId('approval-sheet'))

test('Review opens the sheet over Home: what pays it, the budget left after, when it expires, Sandbox, and Face ID', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Review: Research wants to pay Acme Hosting' }))

  await waitFor(() => expect(sheet().getByText('$420.00 of $2,000.00 (4,200 of 20,000 LXC)')).toBeTruthy())
  expect(sheet().getByText('Research wants to pay')).toBeTruthy()
  expect(sheet().getByText('October hosting invoice')).toBeTruthy()
  expect(sheet().getByLabelText('Sandbox. Works. No real money moves.')).toBeTruthy()
  expect(sheet().getByText('$340.00')).toBeTruthy()
  expect(sheet().getByText('Acme Hosting')).toBeTruthy()
  for (const [label, value] of [
    ['Why it’s asking', 'It asks you above $250.00 (2,500 LXC)'],
    ['Paid from', 'Research’s US dollar account (holds $400.00)'],
    ['Budget left after', '$420.00 of $2,000.00 (4,200 of 20,000 LXC)'],
    ['Expires', 'Tomorrow at 09:17'],
  ])
    expect(sheet().getByLabelText(`${label}: ${value}`)).toBeTruthy()
  expect(sheet().getByText('This approves this payment only. Approving or declining asks for Face ID.')).toBeTruthy()
  expect(sheet().getByRole('button', { name: 'Approve with Face ID' })).toBeTruthy()
  expect(sheet().getByRole('button', { name: 'Decline' })).toBeTruthy()
  expect(screen.queryByText('Deny')).toBeNull()

  // Close leaves it waiting.
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByTestId('approval-sheet')).toBeNull())
  expect(screen.getByRole('button', { name: 'Review: Research wants to pay Acme Hosting' })).toBeTruthy()
})

test('Approve with Face ID signs this approval’s challenge, then the result screen says what happens next', async () => {
  const { calls } = mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Review: Research wants to pay Acme Hosting' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Approve with Face ID' }))

  const result = within(await screen.findByTestId('approval-result'))
  expect(result.getByText('Approved')).toBeTruthy()
  expect(result.getByText('Research’s payment to Acme Hosting goes through the next time it sends it, once. Your approval lasts 24 hours.')).toBeTruthy()
  expect(result.getByLabelText('Signed with: Face ID on this iPhone')).toBeTruthy()
  expect(result.getByLabelText('Paid from: Research’s US dollar account')).toBeTruthy()
  expect(result.getByLabelText('Budget left once it goes through: $420.00 (4,200 LXC)')).toBeTruthy()
  expect(result.getByText('3,400 LXC for its rules')).toBeTruthy()
  expect(result.getByRole('button', { name: 'Done' })).toBeTruthy()
  // The statement Face ID shows is the amount the sheet showed.
  expect(mockPhone.reasons).toEqual(['Approve $340.00 (3,400 LXC) for Research'])
  expect(JSON.parse(calls.find((c) => c.path === '/api/agents/approvals/apr_acme/approve')!.body!)).toEqual({
    assertion: { device_id: 'dk_1', challenge: 'ch_apr_acme', signature: 'signed:talyvor-device-v1:ch_apr_acme' },
  })
})

test('Decline signs, keeps the reason, and the declined screen says what declining does and the budget left', async () => {
  const { calls } = mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Review: Research wants to pay Acme Hosting' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Decline' }))
  await fireEvent.changeText(screen.getByLabelText('Why (optional, the agent sees it)'), 'not this month')
  await fireEvent.press(sheet().getByRole('button', { name: 'Decline' }))

  const result = within(await screen.findByTestId('approval-result'))
  expect(result.getByText('Declined')).toBeTruthy()
  expect(result.getByText('Declined. Research’s payment is refused, and the same request is refused without asking you for 24 hours.')).toBeTruthy()
  expect(result.getByLabelText('Declined with: Face ID on this iPhone')).toBeTruthy()
  expect(result.getByLabelText('Research’s budget left: $760.00 (7,600 LXC)')).toBeTruthy()
  expect(mockPhone.reasons).toEqual(['Decline $340.00 (3,400 LXC) for Research'])
  expect(JSON.parse(calls.find((c) => c.path === '/api/agents/approvals/apr_acme/deny')!.body!)).toEqual({
    assertion: { device_id: 'dk_1', challenge: 'ch_apr_acme', signature: 'signed:talyvor-device-v1:ch_apr_acme' },
    reason: 'not this month',
  })
})

test('Next opens the next request’s sheet, and Done closes the result', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Review: Research wants to pay Acme Hosting' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Approve with Face ID' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Next: Sales wants to use Lead finder' }))

  await waitFor(() => expect(sheet().getByText('Sales wants to use')).toBeTruthy())
  expect(screen.queryByTestId('approval-result')).toBeNull()
  expect(sheet().getByLabelText('Paid from: Your monthly marketplace bill')).toBeTruthy()
  await fireEvent.press(sheet().getByRole('button', { name: 'Approve with Face ID' }))

  const result = within(await screen.findByTestId('approval-result'))
  expect(result.getByText('Sales’s use of Lead finder goes through the next time it sends it, once. Your approval lasts 24 hours.')).toBeTruthy()
  expect(result.getByLabelText('Charged to: Your monthly marketplace bill')).toBeTruthy()
  // Nothing else waits, so there is no Next.
  expect(result.queryByText(/^Next:/)).toBeNull()
  await fireEvent.press(result.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByTestId('approval-result')).toBeNull())
})

test('a phone with no key asks to turn it on first and offers no approve', async () => {
  const { calls } = mockBff()
  mockStore.delete('talyvor.device-key')
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_acme' })

  // A notification lands on the request's own screen with its sheet open.
  expect(await screen.findByText('Turn on Approve with Face ID on this phone first.')).toBeTruthy()
  expect(sheet().getByRole('button', { name: 'Approvals on this phone' })).toBeTruthy()
  expect(sheet().queryByRole('button', { name: 'Approve with Face ID' })).toBeNull()
  expect(sheet().queryByText(/asks for Face ID/)).toBeNull()
  expect(calls.some((c) => /\/approvals\/apr_acme\/(approve|challenge)/.test(c.path))).toBe(false)
})

test('a decided request’s own screen reads Approved and paid or Approved and used, never Approved and spent', async () => {
  mockBff()
  const used = (a: object) => ({ ...a, status: 'used', decided_at: '2026-10-22T09:00:00Z' })
  const answer = { approvals: [used(acme), used(lead)] }
  const fetchBff = globalThis.fetch
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) =>
    url.endsWith('/api/agents/approvals') ? new Response(JSON.stringify(answer)) : fetchBff(url, init),
  ) as unknown as typeof fetch

  await renderRouter('./src/app', { initialUrl: '/approvals/apr_acme' })
  expect(await screen.findByText('Approved and paid. Nothing is waiting for you here.')).toBeTruthy()
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_lead' })
  expect(await screen.findByText('Approved and used. Nothing is waiting for you here.')).toBeTruthy()
  expect(screen.queryByText(/spent/)).toBeNull()
})
