import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library'

// B61.88 — an agent's rules are typed and shown in the account's own currency on the phone, as the web's are (suite
// B61.87): Lens (B61.12) holds them in a currency, each limit in its minor units, and a save names the currency and the
// minor-unit limits and no µLXC limit, which Lens refuses on rules held in pounds or euros.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => 'uuid-1' }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
jest.mock('../../modules/talyvor-keys', () => ({ isAvailable: () => true, sign: async () => 'sig' }))

const agent = { id: 'ag_1', name: 'Research', colour: 'cobalt', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z', wallet_kind: 'fiat', fiat_currency: 'GBP' }
const base = { allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '' }
/** £25 a day, as Lens holds rules typed in pounds: its µLXC form is what the parked gateway reads, and is never sent. */
const pounds = { ...base, currency: 'GBP', max_per_request_ulxc: 0, daily_limit_ulxc: 316_000_000, monthly_limit_ulxc: 0, approval_above_ulxc: 0, max_per_payment_minor: 0, hourly_limit_minor: 0, daily_limit_minor: 2_500, weekly_limit_minor: 0, monthly_limit_minor: 0, approval_above_minor: 0 }
/** $25 a day, set before the rules had a currency of their own. */
const dollars = { ...pounds, currency: 'USD', daily_limit_ulxc: 250_000_000 }

function mockBff(rules: object) {
  const bodies: Record<string, unknown> = {}
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '').split('?')[0]}`
    if (typeof init.body === 'string') bodies[route] = JSON.parse(init.body)
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (route) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/lxc/topup-options':
        return json({ usd_per_lxc: 0.1, min_usd_cents: 1000 })
      case 'GET /api/fx':
        return json({ rate_date: '2026-11-13', usd_per_eur: 1.1, gbp_per_eur: 0.85 })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [agent] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/accounts':
        return json({ accounts: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/money/card-spends':
        return json({ card_spends: [] })
      case 'GET /api/agents/ag_1/rules':
        return json(rules)
      case 'GET /api/agents/ag_1/card':
        return json({ card: { id: 'ic_1', agent_id: 'ag_1', last4: '4242', exp_month: 9, exp_year: 2028, currency: 'gbp', livemode: false, created_at: '2026-11-01T00:00:00Z' }, authorizations: [] })
      case 'GET /api/workspace/account':
        return json({ workspace_id: 'ws_1', account_type: 'personal', money_kind: 'fiat' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Nora Vance' })
      case 'POST /api/agents/ag_1/rules-challenge':
        return json({ looser: false, changes: [], allow_credentials: [] })
      case 'PUT /api/agents/ag_1/rules':
        return json(bodies[route])
    }
    return json({ error: 'not found' }, 404)
  }) as unknown as typeof fetch
  return bodies
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

test('a pounds account’s rules are shown and typed in pounds, and the save names GBP and the minor-unit limits', async () => {
  const bodies = mockBff(pounds)
  await renderRouter('./src/app', { initialUrl: '/cards' })
  const limits = await screen.findByTestId('card-limits-ag_1')
  expect(await within(limits).findByText('Spends at most £25.00 a day.')).toBeTruthy()
  await fireEvent.press(within(limits).getByText('Change limits'))
  const daily = await screen.findByLabelText('Daily limit for Research, in pounds')
  expect(daily.props.value).toBe('25')
  await fireEvent.changeText(daily, '20.50')
  await fireEvent.press(screen.getByText('Save rules'))
  expect(await screen.findByText('Saved. Lens applies these rules to the next request or payment.')).toBeTruthy()
  const saved = bodies['PUT /api/agents/ag_1/rules'] as Record<string, unknown>
  expect(saved).toMatchObject({ currency: 'GBP', daily_limit_minor: 2_050, max_per_payment_minor: 0, monthly_limit_minor: 0, approval_above_minor: 0, hourly_limit_minor: 0, weekly_limit_minor: 0 })
  for (const f of ['max_per_request_ulxc', 'hourly_limit_ulxc', 'daily_limit_ulxc', 'weekly_limit_ulxc', 'monthly_limit_ulxc', 'approval_above_ulxc']) expect(saved).not.toHaveProperty(f)
  expect(screen.queryByText(/LXC/)).toBeNull()
})

test('rules still held in dollars on a pounds account open in pounds at today’s rate, rounded down, and the save names every limit', async () => {
  const bodies = mockBff(dollars)
  await renderRouter('./src/app', { initialUrl: '/cards' })
  await fireEvent.press(within(await screen.findByTestId('card-limits-ag_1')).getByText('Change limits'))
  expect(await screen.findByText('Research’s rules are still held in dollars. Each limit below is in pounds at today’s rate, rounded down: check them, then save to hold the rules in pounds.')).toBeTruthy()
  // $25.00 at 0.85 GBP and 1.10 USD per euro is £19.318…, rounded down to £19.31.
  expect(screen.getByLabelText('Daily limit for Research, in pounds').props.value).toBe('19.31')
  expect(within(screen.getByTestId('limit-row-daily_limit_minor')).getByText('Held at $25.00, rounded down at today’s rate')).toBeTruthy()
  await fireEvent.press(screen.getByText('Save rules'))
  expect(await screen.findByText('Saved. Lens applies these rules to the next request or payment.')).toBeTruthy()
  const saved = bodies['PUT /api/agents/ag_1/rules'] as Record<string, unknown>
  expect(saved).toMatchObject({ currency: 'GBP', daily_limit_minor: 1_931, max_per_payment_minor: 0, hourly_limit_minor: 0, weekly_limit_minor: 0, monthly_limit_minor: 0, approval_above_minor: 0 })
  expect(saved).not.toHaveProperty('daily_limit_ulxc')
})
