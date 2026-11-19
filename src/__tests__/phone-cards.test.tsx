import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { AppState, type AppStateStatus } from 'react-native'

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
/** B61.88 — the rules as the phone saves them: in dollars, every limit in cents, and no µLXC limit. */
const saved = (cents: Partial<Record<'daily_limit_minor' | 'monthly_limit_minor', number>>) => ({
  allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '', currency: 'USD',
  max_per_payment_minor: 0, hourly_limit_minor: 0, daily_limit_minor: 250, weekly_limit_minor: 0, monthly_limit_minor: 3_000, approval_above_minor: 0, ...cents,
})

/** Lens behind the BFF: Research has a card with one purchase, Sales has none. `calls` is every request made. */
function mockBff() {
  const calls: string[] = []
  const bodies: Record<string, unknown> = {}
  const card = { id: 'ic_1', agent_id: 'ag_1', last4: '4242', exp_month: 9, exp_year: 2028, currency: 'gbp', livemode: false, created_at: '2026-11-01T00:00:00Z', frozen: false }
  // B59.55 — Research's one-time and standing cards (Lens B59.21 through the BFF's B59.54); Sales has none.
  const spends = [
    { id: 'cs_1', agent_id: 'ag_1', merchant: 'Figma', amount_minor: 3_900, currency: 'GBP', status: 'active', card: { id: 'mc_1', merchant: 'Figma', cap_minor: 3_900, currency: 'GBP', status: 'active' }, created_at: '2026-11-12T09:00:00Z' },
    { id: 'cs_2', agent_id: 'ag_1', merchant: 'Notion', amount_minor: 2_000, currency: 'USD', standing_card_id: 'rc_1', status: 'active', expires_at: '2026-12-16T09:00:00Z', created_at: '2026-11-11T09:00:00Z' },
    { id: 'cs_3', agent_id: 'ag_1', merchant: 'Linear', amount_minor: 1_200, currency: 'EUR', status: 'awaiting_approval', approval_id: 'ap_1', created_at: '2026-11-10T09:00:00Z' },
  ]
  const spendsAsked: string[] = []
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
      case 'GET /api/lxc/topup-options':
        return json({ usd_per_lxc: 0.1, min_usd_cents: 1000 })
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
      case 'GET /api/money/card-spends': {
        const agent = new URL(url).searchParams.get('agent_id') ?? ''
        spendsAsked.push(agent)
        return json({ card_spends: spends.filter((s) => s.agent_id === agent) })
      }
      case 'POST /api/agents/ag_1/rules-challenge': {
        // Lens judges a raise looser and asks for a signature; a cut is tighter and saved at once.
        // B61.88: the save names its limits in the rules' currency, $2.50 a day as 250 cents.
        const daily = (bodies[route] as { rules: { daily_limit_minor: number } }).rules.daily_limit_minor
        const looser = daily === 0 || daily > 250
        return json(looser ? { looser, changes: ['Daily limit: $2.50 → $4.00'], challenge: 'ch_1', allow_credentials: [] } : { looser, changes: [], allow_credentials: [] })
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
  return Object.assign(calls, { bodies, spendsAsked })
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

// B61.77 — the details open in a sheet over the card once Face ID passes, and Close hides them again.
test('the card details open as a sheet over Cards, and Close returns to Cards with them hidden', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  await fireEvent.press(await screen.findByText('Show card details'))
  const sheet = within(await screen.findByTestId('card-details-sheet'))
  expect(sheet.getByText('•••• 4242')).toBeTruthy()
  await fireEvent.press(sheet.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByTestId('card-details-sheet')).toBeNull())
  expect(screen.queryByText(/4242/)).toBeNull()
  expect(screen.getByText('Show card details')).toBeTruthy()
})

// The sheet is its own window, above the Cover: leaving the app hides the details, so the app switcher never shows them.
test('the card details sheet closes when the app leaves the front, and Face ID is asked again', async () => {
  let tell: ((s: AppStateStatus) => void)[] = []
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, f) => {
    tell.push(f as (s: AppStateStatus) => void)
    return { remove: () => (tell = tell.filter((g) => g !== f)) } as ReturnType<typeof AppState.addEventListener>
  })
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  await fireEvent.press(await screen.findByText('Show card details'))
  expect(await screen.findByTestId('card-details-sheet')).toBeTruthy()
  await act(async () => tell.forEach((f) => f('inactive')))
  await act(async () => tell.forEach((f) => f('active')))
  await waitFor(() => expect(screen.queryByTestId('card-details-sheet')).toBeNull())
  expect(screen.queryByText(/4242/)).toBeNull()
  jest.restoreAllMocks()
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
  const daily = within(screen.getByTestId('card-limits-ag_1')).getByLabelText('Daily limit for Research, in dollars')
  expect(daily.props.value).toBe('2.5')
  await fireEvent.changeText(daily, '4')
  await fireEvent.press(within(screen.getByTestId('card-limits-ag_1')).getByText('Save rules'))
  // Looser: what it loosens is said first, and nothing is saved until the second press signs it.
  expect(await screen.findByText('This loosens Research’s rules:')).toBeTruthy()
  expect(screen.getByText('Daily limit: $2.50 → $4.00')).toBeTruthy()
  expect(calls).not.toContain('PUT /api/agents/ag_1/rules')
  await fireEvent.press(screen.getByText('Save with Face ID'))
  expect(await screen.findByText('Saved. Lens applies these rules to the next request or payment.')).toBeTruthy()
  const put = calls.bodies['PUT /api/agents/ag_1/rules'] as { rules: object; assertion: object }
  expect(put.rules).toEqual(saved({ daily_limit_minor: 400 }))
  expect(put.assertion).toEqual({ device_id: 'dk_1', challenge: 'ch_1', signature: 'sig' })
  expect(mockPhone.signed).toEqual(['talyvor-device-v1:ch_1'])
})

test('B59.44: a lowered limit is saved at once, unsigned, and a limit that is not an amount is never sent', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  await fireEvent.press(within(await screen.findByTestId('card-limits-ag_1')).getByText('Change limits'))
  const monthly = screen.getByLabelText('Monthly limit for Research, in dollars')
  await fireEvent.changeText(monthly, 'lots')
  expect(screen.getByText('A limit is an amount in dollars, or empty.')).toBeTruthy()
  await fireEvent.changeText(monthly, '')
  // B61.88: dollars typed are sent in cents, as the rules' currency counts them.
  await fireEvent.changeText(screen.getByLabelText('Daily limit for Research, in dollars'), '1.23')
  await fireEvent.changeText(monthly, '30')
  await fireEvent.press(screen.getByText('Save rules'))
  expect(await screen.findByText('Saved. Lens applies these rules to the next request or payment.')).toBeTruthy()
  expect(calls.bodies['PUT /api/agents/ag_1/rules']).toEqual(saved({ daily_limit_minor: 123 }))
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

// B57.160 — in Pocket: the owner's card at the top in its tier art, bare as P3's Cards strip draws it; Change limits as
// the reference's rules draw a list of settings, each limit a row with what it is now and its amount in dollars; and the
// cardholder form as a list of settings in one panel.
describe('Cards’ forms in Pocket', () => {
  test('the owner’s card sits at the top, above Disputes and refunds, bare as the Cards strip draws it', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/cards' })
    await screen.findByTestId('owner-card')
    const order = screen.getAllByTestId(/^(owner-card|cards-disputes)$/).map((v) => v.props.testID)
    expect(order).toEqual(['owner-card', 'cards-disputes'])
  })

  test('Change limits draws each limit as a rule row: its name, what it is now, and its amount in dollars', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/cards' })
    await fireEvent.press(within(await screen.findByTestId('card-limits-ag_1')).getByText('Change limits'))
    const daily = within(screen.getByTestId('limit-row-daily_limit_minor'))
    expect(daily.getByText('Daily limit')).toBeTruthy()
    expect(daily.getByText('$2.50')).toBeTruthy()
    expect(daily.getByLabelText('Daily limit for Research, in dollars').props.value).toBe('2.5')
    expect(screen.queryByText(/LXC/)).toBeNull()
    expect(within(screen.getByTestId('limit-row-hourly_limit_minor')).getByText('No limit')).toBeTruthy()
  })

  test('a looser change is said in Pocket’s warning note before Save with Face ID', async () => {
    mockBff()
    mockStore.set('talyvor.device-workspace', 'ws_1')
    await renderRouter('./src/app', { initialUrl: '/cards' })
    await fireEvent.press(within(await screen.findByTestId('card-limits-ag_1')).getByText('Change limits'))
    await fireEvent.changeText(screen.getByLabelText('Daily limit for Research, in dollars'), '4')
    await fireEvent.press(screen.getByText('Save rules'))
    const note = within(await screen.findByTestId('loosens-note'))
    expect(note.getByText('This loosens Research’s rules:')).toBeTruthy()
    expect(note.getByText('Daily limit: $2.50 → $4.00')).toBeTruthy()
  })

  test('the cardholder form is a list of settings rows in one panel', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/cards' })
    await fireEvent.press(within(await screen.findByTestId('card-head-ag_2')).getByText('Issue a card'))
    const panel = within(screen.getByTestId('cardholder-ag_2'))
    for (const [key, label] of [['first_name', 'First name'], ['phone_number', 'Phone (optional)'], ['postal_code', 'Postcode']]) {
      const row = within(panel.getByTestId(`holder-row-${key}`))
      expect(row.getByText(label)).toBeTruthy()
      expect(row.getByLabelText(label)).toBeTruthy()
    }
  })
})

// B59.55 — under each agent's card, its one-time and standing cards (Lens B59.21, the BFF's B59.54): which it is, its
// merchant and the budget the owner approved, a standing card's raise until when, and one still waiting opens Approvals.
test('B59.55: a one-time card and a standing card show under the agent’s card with the budget the owner approved', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  const oneTime = await screen.findByTestId('card-spend-cs_1')
  expect(within(oneTime).getByText('One-time card · Figma')).toBeTruthy()
  expect(within(oneTime).getByText('£39.00')).toBeTruthy()
  expect(within(oneTime).getByText('Budget you approved')).toBeTruthy()
  const standing = screen.getByTestId('card-spend-cs_2')
  expect(within(standing).getByText('Standing card · Notion')).toBeTruthy()
  expect(within(standing).getByText('$20.00')).toBeTruthy()
  expect(within(standing).getByText('Budget you approved, until 16 Dec')).toBeTruthy()
  // Each agent's own are asked for by its id, and sit under its card: Sales has none, so nothing is drawn for it.
  expect(calls.spendsAsked.sort()).toEqual(['ag_1', 'ag_2'])
  const order = screen.getAllByTestId(/^(card-head-ag_1|card-spends|card-head-ag_2)$/).map((v) => v.props.testID)
  expect(order).toEqual(['card-head-ag_1', 'card-spends', 'card-head-ag_2'])
})

test('B59.55: a spend still waiting for the owner says so and opens Approvals', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  const waiting = await screen.findByTestId('card-spend-cs_3')
  expect(within(waiting).getByText('One-time card · Linear')).toBeTruthy()
  expect(within(waiting).getByText('€12.00')).toBeTruthy()
  expect(within(waiting).getByText('Waiting for your approval')).toBeTruthy()
  await fireEvent.press(screen.getByText('Open Approvals'))
  await waitFor(() => expect(screen).toHavePathname('/approvals'))
})

// B57.169 — in Pocket: each one-time or standing card is a row of Pocket Live's Cards panel, with its kind's round picture
// before its words, and one still waiting is the drawing's tangerine waiting row, its count beside Open Approvals.
test('B57.169: each spend row has its kind’s round picture, and the waiting one is the tangerine waiting row', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/cards' })
  expect(within(await screen.findByTestId('card-spend-cs_1')).getByTestId('card-spend-kind-one-time')).toBeTruthy()
  expect(within(screen.getByTestId('card-spend-cs_2')).getByTestId('card-spend-kind-standing')).toBeTruthy()
  const row = screen.getByTestId('card-spends-approvals')
  expect(row.props.accessibilityRole).toBe('link')
  expect(row.props.accessibilityLabel).toBe('Open Approvals, 1 waiting')
  expect(within(row).getByTestId('card-spends-waiting-count')).toHaveTextContent('1')
  await fireEvent.press(row)
  await waitFor(() => expect(screen).toHavePathname('/approvals'))
})
