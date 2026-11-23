import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B61.120 — the Merchants and categories row on the phone, as the web's (suite B61.64): on an agent's Rules and in New
// agent, Lens's seven categories in its order; a save sends allowed_merchant_categories and blocked_merchant_categories
// only when they changed, and allowing one takes it off the blocked list.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => 'uuid-1' }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))
jest.mock('../../modules/talyvor-keys', () => ({ isAvailable: () => true, sign: async () => 'sig' }))

const agent = { id: 'ag_1', name: 'Research', colour: 'cobalt', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z', wallet_kind: 'fiat', fiat_currency: 'GBP' }
const summary = {
  as_of: '2026-11-23T09:00:00Z',
  agent,
  month: { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z', spent_ulxc: 0, forecast_ulxc: 0, monthly_limit_ulxc: 0 },
  approvals: [],
  card: { status: 'active' },
  currency_accounts: [],
}
const pounds = { allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '', currency: 'GBP', max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, max_per_payment_minor: 0, hourly_limit_minor: 0, daily_limit_minor: 2_500, weekly_limit_minor: 0, monthly_limit_minor: 0, approval_above_minor: 0 }

/** The BFF, holding the agent's rules as Lens would: a PUT replaces the lists it names, and the next read returns them. */
function mockBff(held: Record<string, unknown>) {
  const puts: Record<string, unknown>[] = []
  /** what each read of the rules returned, in order */
  const reads: unknown[] = []
  const bodies: Record<string, unknown> = {}
  const made = { id: 'ag_new', name: '', colour: '', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-11-23T00:00:00Z' }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '').split('?')[0]}`
    if (typeof init.body === 'string') bodies[route] = JSON.parse(init.body)
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (route) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/workspace/capabilities':
        return json({ capabilities: [] })
      case 'GET /api/lxc/topup-options':
        return json({ usd_per_lxc: 0.1, min_usd_cents: 1000 })
      case 'GET /api/fx':
        return json({ rate_date: '2026-11-13', usd_per_eur: 1.1, gbp_per_eur: 0.85 })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [agent] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/accounts':
        return json({ accounts: [{ id: 'ca_1', purpose: 'company', currency: 'GBP', status: 'open', balance_minor: 0, test_minor: 0, live_minor: 0 }] })
      case 'GET /api/workspace/account':
        return json({ workspace_id: 'ws_1', account_type: 'personal', money_kind: 'fiat' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Nora Vance' })
      case 'GET /api/agents/ag_1/summary':
        return json(summary)
      case 'GET /api/agents/ag_1/rules':
        reads.push(structuredClone(held))
        return json(held)
      case 'POST /api/agents':
        Object.assign(made, { name: (bodies[route] as { name: string }).name })
        return json(made)
      case 'POST /api/agents/ag_1/rules-challenge':
      case 'POST /api/agents/ag_new/rules-challenge':
        return json({ looser: false, changes: [], allow_credentials: [] })
      case 'PUT /api/agents/ag_1/rules':
      case 'PUT /api/agents/ag_new/rules': {
        const body = bodies[route] as Record<string, unknown>
        puts.push(body)
        Object.assign(held, body)
        return json(held)
      }
    }
    return json({ error: 'not found' }, 404)
  }) as unknown as typeof fetch
  return Object.assign(puts, { reads })
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

async function openRules() {
  await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Research’s rules' }))
  return within(await screen.findByTestId('agent-rules'))
}

test('an agent saved with only Software reads "Merchants and categories · Software" on its Rules after a reload, and the PUT carried ["software"]', async () => {
  const puts = mockBff({ ...pounds })
  const rules = await openRules()
  await fireEvent.press(rules.getByRole('button', { name: 'Merchants and categories · Any merchant' }))
  expect(rules.getAllByRole('checkbox').map((b) => b.props.accessibilityLabel)).toEqual(['Software', 'Hosting', 'Freight', 'Advertising', 'Travel', 'Telecoms', 'Gambling'])
  expect(rules.getByText('Any merchant. Pick some to let it pay only them by card.')).toBeTruthy()
  await fireEvent.press(rules.getByRole('checkbox', { name: 'Software' }))
  expect(rules.getByText('Software. Only these, by card.')).toBeTruthy()
  await fireEvent.press(rules.getByText('Save'))
  expect(await rules.findByText('Saved. Lens applies these rules to the next request or payment.')).toBeTruthy()
  expect(puts).toHaveLength(1)
  expect(puts[0]).toMatchObject({ currency: 'GBP', daily_limit_minor: 2_500, allowed_merchant_categories: ['software'], blocked_merchant_categories: [] })
  // The page reads the agent's rules again after the save, and the row is drawn from what that read returned.
  await waitFor(() => expect(puts.reads).toHaveLength(2))
  expect(puts.reads[1]).toMatchObject({ allowed_merchant_categories: ['software'] })
  expect(await rules.findByRole('button', { name: 'Merchants and categories · Software' })).toBeTruthy()
})

test('allowing a blocked category takes it off the blocked list, and a Save that changes nothing sends nothing', async () => {
  const puts = mockBff({ ...pounds, allowed_merchant_categories: ['software'], blocked_merchant_categories: ['gambling', 'travel'] })
  const rules = await openRules()
  const row = rules.getByRole('button', { name: 'Merchants and categories · Software. Never travel, gambling' })
  await fireEvent.press(row)
  await fireEvent.press(rules.getByText('Save'))
  await waitFor(() => expect(rules.getByRole('button', { name: /^Merchants and categories · / }).props.accessibilityHint).toBe('Edit'))
  expect(puts).toHaveLength(0)
  await fireEvent.press(rules.getByRole('button', { name: /^Merchants and categories · / }))
  await fireEvent.press(rules.getByRole('checkbox', { name: 'Travel' }))
  await fireEvent.press(rules.getByText('Save'))
  expect(await rules.findByRole('button', { name: 'Merchants and categories · Software, travel. Never gambling' })).toBeTruthy()
  expect(puts).toHaveLength(1)
  expect(puts[0]).toMatchObject({ allowed_merchant_categories: ['software', 'travel'], blocked_merchant_categories: ['gambling'] })
})

test('a rules save that does not touch the merchant categories leaves them out, so Lens keeps them', async () => {
  const { merchantsSave, rulesSave } = jest.requireActual('@talyvor/bff-client')
  const held = { ...pounds, allowed_merchant_categories: ['software'], blocked_merchant_categories: ['gambling'] }
  expect(rulesSave(held, 0.1)).not.toHaveProperty('allowed_merchant_categories')
  expect(rulesSave(held, 0.1)).not.toHaveProperty('blocked_merchant_categories')
  expect(merchantsSave(held, 0.1, ['software'])).toBeNull()
})

test('New agent: picking Software reads "Software. Only these, by card." and Create sends allowed_merchant_categories ["software"]', async () => {
  const puts = mockBff({ ...pounds })
  await renderRouter('./src/app', { initialUrl: '/agents' })
  await fireEvent.press(await screen.findByText('New agent'))
  await fireEvent.press(await screen.findByRole('radio', { name: /^Your own\./ }))
  await fireEvent.press(screen.getByText('Continue'))
  await fireEvent.changeText(await screen.findByLabelText('Its name'), 'Atlas')
  await fireEvent.press(screen.getByText('Continue'))
  const row = within(await screen.findByTestId('new-agent-merchants'))
  expect(row.getByText('Merchants and categories')).toBeTruthy()
  expect(row.getByText('Any merchant. Pick some to let it pay only them by card.')).toBeTruthy()
  await fireEvent.press(row.getByRole('checkbox', { name: 'Software' }))
  expect(row.getByText('Software. Only these, by card.')).toBeTruthy()
  await fireEvent.press(screen.getByText('Create agent'))
  await waitFor(() => expect(screen).toHavePathname('/agents/ag_new'))
  expect(puts[0]).toMatchObject({ currency: 'GBP', allowed_merchant_categories: ['software'] })
})
