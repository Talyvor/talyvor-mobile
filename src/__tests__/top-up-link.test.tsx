import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B48.45 — the phone's twin of the web's B48.44 and B57.224: the link an agent's wallet_topup_link hands its owner (Lens
// B48.39), /agents/<id>?top_up=<move>, opens on the agent's screen the quote Lens B48.43 reads back by id and a press that
// confirms it through Lens B48.8's …/wallet-moves/<move>/confirm once; an expired quote says so, and Add money quotes the
// same top-up again; a move that is not this agent's moved nothing, and Not now closes it. The words are the web's
// (talyvor-suite AgentWalletActions.tsx TopUpLink).

jest.setTimeout(60_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => 'key-1' }))

const research = { id: 'ag_1', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, wallet_kind: 'crypto', created_at: '2026-09-14T09:00:00Z' }
const IN_AN_HOUR = new Date(Date.now() + 3_600_000).toISOString()
const move = (over: object = {}) => ({
  id: 'wm_ask', agent_id: 'ag_1', route: 'card', sell_minor: 10_000, sell_currency: 'EUR', fee_minor: 150, buy_minor: 106_700_000,
  buy_currency: 'USDC', rate: '1.0820', status: 'quoted', expires_at: IN_AN_HOUR, created_at: '2026-11-25T09:59:30Z', ...over,
})

/** Every call the screen sent: its method, path and body. */
let calls: { call: string; body: unknown }[] = []

function mockBff(asked: object) {
  calls = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path] = url.replace('https://bff.test', '').split('?')
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    const call = `${init.method ?? 'GET'} ${path}`
    calls.push({ call, body: init.body ? JSON.parse(String(init.body)) : undefined })
    switch (call) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'business', money_kind: 'hybrid' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [research] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/agents/ag_1/summary':
        return json({
          as_of: '2026-11-26T10:00:00Z',
          agent: research,
          month: { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z', spent_ulxc: 0, forecast_ulxc: 0, monthly_limit_ulxc: 0 },
          approvals: [],
          card: { status: 'none' },
          currency_accounts: [],
        })
      case 'GET /api/agents/ag_1/rules':
        return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'UTC' })
      case 'GET /api/money/devices':
        return json({ devices: [] })
      case 'GET /api/agents/ag_1/wallet-moves/wm_ask':
        return json(asked)
      case 'POST /api/agents/ag_1/wallet-moves/wm_ask/confirm':
        return json({ ...asked, status: 'posted' })
      case 'POST /api/agents/ag_1/wallet-moves/quote':
        return json(move({ id: 'wm_new', fee_minor: 160 }))
      case 'POST /api/agents/ag_1/wallet-moves/wm_new/confirm':
        return json(move({ id: 'wm_new', status: 'posted' }))
    }
    return json({ error: 'no such move' }, 404)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

const confirms = () => calls.filter((c) => c.call.startsWith('POST') && c.call.endsWith('/confirm')).map((c) => c.call)
const open = async (asked: object, link = '/agents/ag_1?top_up=wm_ask') => {
  mockBff(asked)
  await renderRouter('./src/app', { initialUrl: link })
  return within(await screen.findByTestId('agent-top-up-link', {}, { timeout: 5_000 }))
}
/** The quote's facts as read top to bottom: each name, then its value. */
const facts = (card: ReturnType<typeof within>) => within(card.getByTestId('wallet-move-facts')).getAllByText(/./).map((t) => t.props.children)

test('the link opens the quote read by its id, and its Move, pressed twice, confirms it once', async () => {
  const card = await open(move())
  expect(card.getByText('Add money to Research')).toBeTruthy()
  expect(card.getByText('Research asked for this top-up. Nothing moves until you confirm.')).toBeTruthy()
  await card.findByTestId('wallet-move-quote')
  expect(facts(card)).toEqual(['From', 'Your card', 'You send', '€100.00', 'Rate', '1 EUR = 1.0820 USDC', 'Fee', '€1.50', 'They get', '106.70 USDC'])
  expect(card.getByTestId('wallet-move-seconds-left').props.children.join('')).toMatch(/^\d+ seconds left$/)
  expect(calls.some((c) => c.call === 'GET /api/agents/ag_1/wallet-moves/wm_ask')).toBe(true)

  // Two presses in one go, before the first has re-rendered the button disabled.
  const press = card.getByRole('button', { name: 'Move €100.00' })
  await act(async () => {
    void fireEvent.press(press)
    void fireEvent.press(press)
  })
  expect(await card.findByText('Added: 106.70 USDC is in Research’s wallet.')).toBeTruthy()
  expect(confirms()).toEqual(['POST /api/agents/ag_1/wallet-moves/wm_ask/confirm'])
})

test('an expired quote says so, moves nothing, and Add money quotes the same top-up again', async () => {
  const card = await open(move({ expires_at: '2026-11-25T08:00:00Z' }))
  expect(await card.findByText('This quote has expired. Nothing moved.')).toBeTruthy()
  expect(card.queryByRole('button', { name: /^Move/ })).toBeNull()
  await fireEvent.press(card.getByRole('button', { name: 'Add money' }))
  await waitFor(() => expect(facts(card)).toContain('€1.60'))
  expect(calls.filter((c) => c.call === 'POST /api/agents/ag_1/wallet-moves/quote').map((c) => c.body)).toEqual([{ route: 'card', amount_minor: 10_000, currency: 'EUR' }])
  await fireEvent.press(card.getByRole('button', { name: 'Move €100.00' }))
  await card.findByText('Added: 106.70 USDC is in Research’s wallet.')
  expect(confirms()).toEqual(['POST /api/agents/ag_1/wallet-moves/wm_new/confirm'])
})

test('a link that is not this agent’s top-up moved nothing, and Not now closes it', async () => {
  const card = await open(move(), '/agents/ag_1?top_up=wm_gone')
  expect(await card.findByText('This top-up link is not one Research asked you for, or it has gone. Nothing moved.')).toBeTruthy()
  await fireEvent.press(card.getByRole('button', { name: 'Not now' }))
  await waitFor(() => expect(screen.queryByTestId('agent-top-up-link')).toBeNull())
  expect(screen.getByTestId('agent-actions')).toBeTruthy()
  expect(confirms()).toEqual([])
})
