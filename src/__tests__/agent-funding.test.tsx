import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B61.85 — Add money and Take back on the phone (the web's B61.84): on an agent's screen, whose round actions are Add
// money, Take back, Pause and Rules in that order, and on Wallets beside each of Your agents. The amount is typed in the
// account's currency, one review line, one move under one key, what moved said back; Lens's refusal in its words.

jest.setTimeout(60_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
let mockUUID = 0
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => `key-${++mockUUID}` }))

const research = { id: 'ag_1', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-09-14T09:00:00Z' }
const accounts = [
  { id: 'acc_usd', currency: 'USD', purpose: 'company', status: 'open', name: 'The company · USD', balance_minor: 9_000 },
  { id: 'acc_r_usd', agent_id: 'ag_1', currency: 'USD', purpose: 'agent', status: 'open', name: 'Research · USD', balance_minor: 1_000 },
]

/** Every write the screen sent: its method and path, its body and its Idempotency-Key. */
let writes: { call: string; body: unknown; key: string | undefined }[] = []

/** `funding` answers each funding POST in turn: 'ok', 'dropped' (the answer never arrives) or a Lens refusal. */
function mockBff(funding: ('ok' | 'dropped' | { status: number; error: string })[] = ['ok']) {
  writes = []
  const answers = [...funding]
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path] = url.replace('https://bff.test', '').split('?')
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    const call = `${init.method ?? 'GET'} ${path}`
    if (init.method === 'POST') writes.push({ call, body: init.body ? JSON.parse(String(init.body)) : undefined, key: (init.headers as Record<string, string>)['Idempotency-Key'] })
    if (call === 'POST /api/money/accounts/acc_r_usd/funding') {
      const a = answers.shift() ?? 'ok'
      if (a === 'dropped') throw new TypeError('Network request failed')
      if (a !== 'ok') return json({ error: a.error }, a.status)
      const body = JSON.parse(String(init.body)) as { direction: string; amount_minor: number }
      return json({ ...body, currency: 'USD', company_account_id: 'acc_usd', agent_account_id: 'acc_r_usd', agent_id: 'ag_1', company_balance_minor: 0, agent_balance_minor: 0 })
    }
    switch (call) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'business', money_kind: 'fiat' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [research] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/agents/ag_1/summary':
        return json({
          as_of: '2026-11-16T10:00:00Z',
          agent: research,
          month: { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z', spent_ulxc: 0, forecast_ulxc: 0, monthly_limit_ulxc: 0 },
          approvals: [],
          card: { status: 'none' },
          currency_accounts: [accounts[1]],
        })
      case 'GET /api/agents/ag_1/rules':
        return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'UTC' })
      case 'GET /api/money/accounts':
        return json({ accounts })
      case 'GET /api/money/devices':
        return json({ devices: [] })
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

const fundings = () => writes.filter((w) => w.call.endsWith('/funding'))

test("the agent's screen: Add money, Take back, Pause and Rules, and Add money moves once under one key", async () => {
  mockBff(['dropped', 'ok'])
  await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })
  const round = within(await screen.findByTestId('agent-actions'))
  expect(round.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Add money to Research', 'Take back from Research', 'Pause', 'Research’s rules'])
  expect(screen.getByRole('button', { name: /Research’s card/ })).toBeTruthy()

  await fireEvent.press(round.getByRole('button', { name: 'Add money to Research' }))
  expect(await screen.findByText('From the company account. It holds $90.00.')).toBeTruthy()
  await fireEvent.changeText(screen.getByLabelText('Amount in USD'), '10')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  const review = within(await screen.findByTestId('agent-funding-review'))
  expect(review.getByText('From the company account to Research’s US dollar account, now.')).toBeTruthy()
  expect(fundings()).toEqual([])

  // The first answer is dropped: the second press goes under the same key, so Lens moves the money once.
  await fireEvent.press(screen.getByRole('button', { name: 'Move $10.00' }))
  expect(await screen.findByText('Nothing changed. You can try again.')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'Move $10.00' }))
  expect(await screen.findByText('$10.00 moved to Research.')).toBeTruthy()
  expect(fundings()).toHaveLength(2)
  expect(fundings()[0]).toEqual({ call: 'POST /api/money/accounts/acc_r_usd/funding', body: { direction: 'to_agent', amount_minor: 1000 }, key: expect.stringMatching(/^key-/) })
  expect(fundings()[1].key).toBe(fundings()[0].key)
  await waitFor(() => expect(screen.queryByTestId('agent-funding')).toBeNull())
})

test('Wallets: each of Your agents has Add money and Take back, and Take back moves into the company account', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  const agents = within(await screen.findByTestId('wallets-agents'))
  expect(agents.getByText('Your team’s agents')).toBeTruthy()
  expect(agents.getByRole('button', { name: 'Add money to Research' })).toBeTruthy()
  await fireEvent.press(agents.getByRole('button', { name: 'Take back from Research' }))
  expect(await screen.findByText('Into the company account. Research holds $10.00.')).toBeTruthy()
  await fireEvent.changeText(screen.getByLabelText('Amount in USD'), '4')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Take back $4.00' }))
  expect(await screen.findByText('$4.00 back from Research.')).toBeTruthy()
  expect(fundings()).toEqual([{ call: 'POST /api/money/accounts/acc_r_usd/funding', body: { direction: 'to_company', amount_minor: 400 }, key: expect.stringMatching(/^key-/) }])
})

test("Lens's refusal is said in Lens's words, and nothing is said to have moved", async () => {
  mockBff([{ status: 403, error: 'only the owner or an admin may move money' }])
  await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Add money to Research' }))
  await fireEvent.changeText(await screen.findByLabelText('Amount in USD'), '10')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Move $10.00' }))
  expect(await screen.findByText('Only the owner or an admin may move money.')).toBeTruthy()
  expect(screen.queryByText('$10.00 moved to Research.')).toBeNull()
  expect(fundings()).toHaveLength(1)
})
