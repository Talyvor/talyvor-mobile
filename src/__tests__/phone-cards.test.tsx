import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

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
  const bodies: Record<string, unknown> = {}
  const card = { id: 'ic_1', agent_id: 'ag_1', last4: '4242', exp_month: 9, exp_year: 2028, currency: 'gbp', livemode: false, created_at: '2026-11-01T00:00:00Z', frozen: false }
  const purchases = [{ id: 'ca_1', approved: false, reason: 'Over its daily limit.', amount_minor: 4_500, currency: 'gbp', merchant_name: '', created_at: '2026-11-10T09:00:00Z' }]
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '').split('?')[0]}`
    calls.push(route)
    if (typeof init.body === 'string') bodies[route] = JSON.parse(init.body)
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
      case 'GET /api/money/accounts':
        return json({ accounts: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/agents/ag_1/rules':
      case 'GET /api/agents/ag_2/rules':
        return json(rules)
      case 'GET /api/workspace/account':
        return json({ workspace_id: 'ws_1', account_type: 'personal', money_kind: 'fiat' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Nora Vance' })
      case 'GET /api/agents/ag_1/card':
        return json({ card, authorizations: purchases })
      case 'POST /api/agents/ag_1/rules-challenge': {
        // Lens judges a raise looser and asks for a signature; a cut is tighter and saved at once.
        const daily = (bodies[route] as { rules: { daily_limit_ulxc: number } }).rules.daily_limit_ulxc
        const looser = daily === 0 || daily > rules.daily_limit_ulxc
        return json(looser ? { looser, changes: ['Daily limit: 25 LXC → 40 LXC'], challenge: 'ch_1', allow_credentials: [] } : { looser, changes: [], allow_credentials: [] })
      }
      case 'PUT /api/agents/ag_1/rules': {
        const b = bodies[route] as { rules?: typeof rules; assertion?: unknown }
        return json(b.rules ?? b)
      }
      case 'POST /api/agents/ag_2/card':
        return json({ ...card, id: 'ic_2', agent_id: 'ag_2', last4: '1881' })
      case 'POST /api/agents/ag_1/card/freeze':
        card.frozen = true
        return json(card)
      case 'POST /api/agents/ag_1/card/unfreeze':
        card.frozen = false
        return json(card)
    }
    return json({ error: 'not found' }, 404)
  }) as unknown as typeof fetch
  return Object.assign(calls, { bodies })
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

// B57.136 — in Pocket: the card sits in its panel with the agent's name and Frozen, as the reference's agent page draws
// it, and Freeze card is the reference's switch.
test('B57.136: the card sits in Pocket’s panel with its name, and Freeze card is a switch that says Frozen', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  const head = await screen.findByTestId('card-head-ag_1')
  expect(within(head).getByLabelText("Research, Research's agent card")).toBeTruthy()
  expect(within(head).getByRole('header', { name: 'Research' })).toBeTruthy()
  const freeze = within(head).getByRole('switch', { name: 'Freeze card' })
  expect(freeze.props.accessibilityState.checked).toBe(false)
  expect(within(head).queryByText('Frozen')).toBeNull()

  await fireEvent.press(freeze)
  expect(await screen.findByText(unmasked(WEB.frozen('Research', '4242')))).toBeTruthy()
  await waitFor(() => expect(within(screen.getByTestId('card-head-ag_1')).getByText('Frozen')).toBeTruthy())
  expect(within(screen.getByTestId('card-head-ag_1')).getByRole('switch', { name: 'Freeze card' }).props.accessibilityState.checked).toBe(true)
  expect(calls).toContain('POST /api/agents/ag_1/card/freeze')

  await fireEvent.press(within(screen.getByTestId('card-head-ag_1')).getByRole('switch', { name: 'Freeze card' }))
  expect(await screen.findByText(unmasked(WEB.unfrozen('Research', '4242')))).toBeTruthy()
  await waitFor(() => expect(screen.queryByText('Frozen')).toBeNull())
  expect(calls).toContain('POST /api/agents/ag_1/card/unfreeze')
})

test('B57.136: the limits sit in their own panel, and an agent with no card says so in its panel', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  const limits = await screen.findByTestId('card-limits-ag_1')
  expect(within(limits).getByText('Limits')).toBeTruthy()
  expect(within(limits).getByText(`${WEB.issueLine}.`)).toBeTruthy()
  expect(within(screen.getByTestId('card-head-ag_2')).getByText('No card for Sales yet.')).toBeTruthy()
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

// B59.44 — the owner's own card above the agents', changing a card's limits signed with the phone's key as the web's Save
// rules is, and issuing an agent a card with the web's cardholder form (AgentCardPanel.tsx IssueCard).
test('B59.44: the owner’s own card is drawn above the agents’ cards, in its account’s tier art', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  const own = await screen.findByTestId('owner-card')
  expect(within(own).getByText('Your card')).toBeTruthy()
  expect(within(own).getByText('Nora Vance')).toBeTruthy()
  expect(within(own).getByText('Your everyday account')).toBeTruthy()
  const order = screen.getAllByTestId(/^(owner-card|card-head-ag_1)$/).map((v) => v.props.testID)
  expect(order).toEqual(['owner-card', 'card-head-ag_1'])
})

test('B59.44: a raised limit is saved signed with Face ID, over the challenge Lens gave for exactly that change', async () => {
  const calls = mockBff()
  // The phone's key was made in this workspace, so it signs here.
  mockStore.set('talyvor.device-workspace', 'ws_1')
  await renderRouter('./src/app', { initialUrl: '/cards' })
  const limits = await screen.findByTestId('card-limits-ag_1')
  await fireEvent.press(within(limits).getByText('Change limits'))
  const daily = within(screen.getByTestId('card-limits-ag_1')).getByLabelText('Daily limit for Research, in LXC')
  expect(daily.props.value).toBe('25')
  await fireEvent.changeText(daily, '40')
  await fireEvent.press(within(screen.getByTestId('card-limits-ag_1')).getByText('Save rules'))
  // Looser: what it loosens is said first, and nothing is saved until the second press signs it.
  expect(await screen.findByText('This loosens Research’s rules:')).toBeTruthy()
  expect(screen.getByText('Daily limit: 25 LXC → 40 LXC')).toBeTruthy()
  expect(calls).not.toContain('PUT /api/agents/ag_1/rules')
  await fireEvent.press(screen.getByText('Save with Face ID'))
  expect(await screen.findByText('Saved. Lens applies these rules to the next request or payment.')).toBeTruthy()
  const saved = calls.bodies['PUT /api/agents/ag_1/rules'] as { rules: typeof rules & { requests_per_minute?: number }; assertion: object }
  expect(saved.rules).toEqual({ ...rules, daily_limit_ulxc: 40_000_000 })
  expect(saved.assertion).toEqual({ device_id: 'dk_1', challenge: 'ch_1', signature: 'sig' })
  expect(mockPhone.signed).toEqual(['talyvor-device-v1:ch_1'])
})

test('B59.44: a lowered limit is saved at once, unsigned, and a limit that is not an amount is never sent', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  await fireEvent.press(within(await screen.findByTestId('card-limits-ag_1')).getByText('Change limits'))
  const monthly = screen.getByLabelText('Monthly limit for Research, in LXC')
  await fireEvent.changeText(monthly, 'lots')
  expect(screen.getByText('A limit is an amount of LXC with at most six decimals, or empty.')).toBeTruthy()
  await fireEvent.changeText(monthly, '')
  await fireEvent.changeText(screen.getByLabelText('Daily limit for Research, in LXC'), '10')
  await fireEvent.changeText(monthly, '300')
  await fireEvent.press(screen.getByText('Save rules'))
  expect(await screen.findByText('Saved. Lens applies these rules to the next request or payment.')).toBeTruthy()
  expect(calls.bodies['PUT /api/agents/ag_1/rules']).toEqual({ ...rules, daily_limit_ulxc: 10_000_000 })
  expect(mockPhone.signed).toEqual([])
})

test('B59.44: an agent with no card is issued one with the web’s cardholder form', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  const head = await screen.findByTestId('card-head-ag_2')
  await fireEvent.press(within(head).getByText('Issue a card'))
  expect(screen.getByText(/^Give Sales a virtual card\. Each purchase is paid from its wallet only if its rules allow it/)).toBeTruthy()
  const issue = () => within(screen.getByTestId('issue-card-ag_2')).getByRole('button', { name: 'Issue a card' })
  expect(issue().props.accessibilityState.disabled).toBe(true)
  await fireEvent.changeText(screen.getByLabelText('First name'), 'Ada')
  await fireEvent.changeText(screen.getByLabelText('Last name'), 'Lovelace')
  await fireEvent.changeText(screen.getByLabelText('Address'), '1 Bank St')
  await fireEvent.changeText(screen.getByLabelText('Town or city'), 'London')
  await fireEvent.changeText(screen.getByLabelText('Postcode'), 'E14 5AB')
  await fireEvent.changeText(screen.getByLabelText('Phone (optional)'), '07700')
  expect(screen.getByText('The phone number needs its country code, like +44 7700 900123.')).toBeTruthy()
  expect(issue().props.accessibilityState.disabled).toBe(true)
  await fireEvent.changeText(screen.getByLabelText('Phone (optional)'), '+44 7700 900123')
  await fireEvent.press(issue())
  await waitFor(() => expect(calls).toContain('POST /api/agents/ag_2/card'))
  expect(calls.bodies['POST /api/agents/ag_2/card']).toEqual({
    first_name: 'Ada', last_name: 'Lovelace', email: '', phone_number: '+447700900123', line1: '1 Bank St', line2: '', city: 'London', postal_code: 'E14 5AB', country: 'GB',
  })
})
