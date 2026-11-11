import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

// B59.34 — Cards on the phone: each agent's card in its art, its details hidden until Face ID, freeze and unfreeze, the
// limits its purchases are judged by, and every purchase, in the web's words.

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

/** The phone's key: `face` is whether Face ID passes; `signed` is every message it signed. */
const mockPhone = { has: true, face: true, signed: [] as string[] }
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_: string, message: string) => {
    if (!mockPhone.has) throw Object.assign(new Error('no key'), { code: 'ERR_TALYVOR_KEY' })
    if (!mockPhone.face) throw Object.assign(new Error('Face ID did not confirm'), { code: 'ERR_BIOMETRIC' })
    mockPhone.signed.push(message)
    return 'sig'
  },
}))

// The web's own words, as apps/web/src/areas/lens/AgentCardPanel.tsx and areas/chat/CardFreeze.tsx in talyvor-suite show them.
const WEB = {
  noPurchases: 'No purchases yet. Each one appears here when the agent pays with this card, with what its rules decided and why.',
  issueLine: 'Each purchase is paid from its wallet only if its rules allow it',
  frozen: (name: string, last4: string) => `Frozen. Every purchase on ${name}’s card •••• ${last4} is refused, and nothing leaves its wallet, until you unfreeze it.`,
  unfrozen: (name: string, last4: string) => `Unfrozen. ${name}’s card •••• ${last4} takes purchases again, each one judged by ${name}’s rules.`,
}
// The phone says the same without the last four digits, which it shows only after Face ID.
const unmasked = (s: string) => s.replace(/ •••• \d{4}/, '')

const agents = [
  { id: 'ag_1', name: 'Research', description: 'Research', colour: 'cobalt', balance_ulxc: 5_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
  { id: 'ag_2', name: 'Sales', colour: 'mint', balance_ulxc: 2_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
]
const rules = { max_per_request_ulxc: 0, daily_limit_ulxc: 25_000_000, monthly_limit_ulxc: 300_000_000, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '' }

/** Lens behind the BFF: Research has a card with one purchase, Sales has none. `calls` is every request made. */
function mockBff() {
  const calls: string[] = []
  const card = { id: 'ic_1', agent_id: 'ag_1', last4: '4242', exp_month: 9, exp_year: 2028, currency: 'gbp', livemode: false, created_at: '2026-11-01T00:00:00Z', frozen: false }
  const purchases = [{ id: 'ca_1', approved: false, reason: 'Over its daily limit.', amount_minor: 4_500, currency: 'gbp', merchant_name: '', created_at: '2026-11-10T09:00:00Z' }]
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '').split('?')[0]}`
    calls.push(route)
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (route) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 7_000_000, allocated_ulxc: 7_000_000, unallocated_ulxc: 0, spent_ulxc: 0, agents })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/agents/ag_1/rules':
      case 'GET /api/agents/ag_2/rules':
        return json(rules)
      case 'GET /api/agents/ag_1/card':
        return json({ card, authorizations: purchases })
      case 'POST /api/agents/ag_1/card/freeze':
        card.frozen = true
        return json(card)
      case 'POST /api/agents/ag_1/card/unfreeze':
        card.frozen = false
        return json(card)
    }
    return json({ error: 'not found' }, 404)
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dk_1')
  Object.assign(mockPhone, { has: true, face: true, signed: [] })
})

test('opens from Home and draws each agent card in its art', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  await fireEvent.press(await screen.findByLabelText('See all cards'))
  expect(await screen.findByText('Your agents’ cards')).toBeTruthy()
  expect(screen.getByLabelText("Research, Research's agent card")).toBeTruthy()
  expect(screen.getByText('No card for Sales yet.')).toBeTruthy()
})

test('the card details stay hidden until Face ID passes', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  await screen.findByText('Show card details')
  expect(screen.queryByText(/4242/)).toBeNull()
  expect(screen.queryByText(/expires/)).toBeNull()

  mockPhone.face = false
  await fireEvent.press(screen.getByText('Show card details'))
  expect(screen.queryByText(/4242/)).toBeNull()

  mockPhone.face = true
  await fireEvent.press(screen.getByText('Show card details'))
  expect(await screen.findByText('•••• 4242')).toBeTruthy()
  expect(screen.getByText('expires 09/28 · GBP')).toBeTruthy()
  // What Face ID signed can never pass as a Lens approval.
  expect(mockPhone.signed).toEqual(['talyvor-phone-check-v1:uuid-1'])

  await fireEvent.press(screen.getByText('Hide card details'))
  expect(screen.queryByText(/4242/)).toBeNull()
})

test('a phone with no key shows no details and says where to turn approving on', async () => {
  mockBff()
  mockStore.delete('talyvor.device-key')
  await renderRouter('./src/app', { initialUrl: '/cards' })
  await fireEvent.press(await screen.findByText('Show card details'))
  expect(await screen.findByText(/Turn approving on in Approvals first\./)).toBeTruthy()
  expect(screen.queryByText(/4242/)).toBeNull()
  expect(mockPhone.signed).toEqual([])
})

test('freezes and unfreezes the card, in the web’s words', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  await fireEvent.press(await screen.findByText('Freeze card'))
  expect(await screen.findByText(unmasked(WEB.frozen('Research', '4242')))).toBeTruthy()
  expect(await screen.findByText('Frozen')).toBeTruthy()
  expect(calls).toContain('POST /api/agents/ag_1/card/freeze')

  await fireEvent.press(await screen.findByText('Unfreeze card'))
  expect(await screen.findByText(unmasked(WEB.unfrozen('Research', '4242')))).toBeTruthy()
  await waitFor(() => expect(screen.queryByText('Frozen')).toBeNull())
  expect(calls).toContain('POST /api/agents/ag_1/card/unfreeze')
})

test('shows the limits each purchase is judged by, and each purchase with what the rules decided', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  expect(await screen.findByText(`${WEB.issueLine}.`)).toBeTruthy()
  expect(screen.getAllByText(/^Spends at most .+ a day\.$/)).toHaveLength(1)
  expect(screen.getAllByText(/^Spends at most .+ a month\.$/)).toHaveLength(1)
  expect(screen.getByText('A merchant')).toBeTruthy()
  expect(screen.getByText('Over its daily limit.')).toBeTruthy()
  expect(screen.getByText('Declined')).toBeTruthy()
  expect(screen.getByText('£45.00')).toBeTruthy()
})

test('a card with no purchases says so in the web’s words', async () => {
  mockBff()
  const real = globalThis.fetch
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const res = await (real as (u: string, i?: RequestInit) => Promise<Response>)(url, init)
    if (!url.endsWith('/api/agents/ag_1/card')) return res
    const body = (await res.json()) as object
    return new Response(JSON.stringify({ ...body, authorizations: null }), { status: 200 })
  }) as unknown as typeof fetch
  await renderRouter('./src/app', { initialUrl: '/cards' })
  expect(await screen.findByText(WEB.noPurchases)).toBeTruthy()
})
