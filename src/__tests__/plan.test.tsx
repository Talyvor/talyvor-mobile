import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B61.60 — Settings, Plan on the phone, as the web's (suite B61.59): the account's plan and the ladder of its own type,
// every figure Lens's. The ladders are GET /api/pricing's (Lens's GET /v1/public/plans) and the plan GET /api/plan's; the
// figures below are NOT Lens's defaults on purpose, so a figure typed into the screen could not pass for one read from
// Lens. Changing plan asks once, then Lens decides, and its refusal is said in its own words.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** The web's strings, typed from suite 6a44d8b (apps/web/src/areas/lens/PlanSettings.tsx): the phone's screen is checked
 * against these, not against its own copy. */
const WEB = {
  sandbox: 'In Sandbox a plan costs nothing. The price is what it will cost when real money is live.',
  forPerson: 'Plans for a person',
  forCompany: 'Plans for a company',
  custom: 'Custom: talk to us',
  change: 'Change plan',
}

const LADDERS = {
  currencies: ['GBP', 'EUR', 'USD'],
  stablecoin_priced_in: 'USD',
  personal: [
    { id: 'personal_solo', name: 'Solo', price_minor: { GBP: 0, EUR: 0, USD: 0 }, agents: 4, people: 1 },
    { id: 'personal_crew', name: 'Crew', price_minor: { GBP: 412, EUR: 433, USD: 455 }, agents: 11, people: 1 },
    { id: 'personal_fleet', name: 'Fleet', price_minor: { GBP: 812, EUR: 913, USD: 1014 }, agents: 27, people: 1 },
  ],
  business: [
    { id: 'business_studio', name: 'Studio', price_minor: { GBP: 1100, EUR: 1100, USD: 1100 }, agents: 3, people: 1 },
    { id: 'business_company', name: 'Company', price_minor: { GBP: 3600, EUR: 3700, USD: 3800 }, agents: 26, people: 6 },
    { id: 'business_group', name: 'Group', price_minor: { GBP: 12600, EUR: 12700, USD: 12800 }, agents: -1, people: 24 },
    { id: 'business_custom', name: 'Custom', price_minor: null, by_contract: true, agents: -1, people: -1 },
  ],
}
const FEES = { fx_margin_bps: { personal_solo: 110, personal_crew: 45, personal_fleet: 0, business_studio: 60, business_company: 35 } }

const PERSONAL = { plan: 'personal_crew', name: 'Crew', account_type: 'personal', on_contract: false, price_minor: LADDERS.personal[1].price_minor, agents: 11, agents_used: 5, seats: 1 }
const BUSINESS = { plan: 'business_company', name: 'Company', account_type: 'business', on_contract: false, price_minor: LADDERS.business[1].price_minor, agents: 26, agents_used: 2, seats: 6 }

type Plan = Omit<typeof PERSONAL, 'price_minor'> & { price_minor: Record<string, number> | null }

/** Lens behind the BFF; `puts` is every plan change the app sent. */
function mockBff(plan: Plan, { currency = 'GBP', change }: { currency?: string; change?: { status: number; body: unknown } } = {}) {
  const puts: unknown[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const method = init.method ?? 'GET'
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_plan' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_plan', name: 'Plan test' })
      case 'GET /api/workspace/account':
        return json({ account_type: plan.account_type, money_kind: 'fiat' })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/money/accounts':
        return json({ accounts: [{ id: 'ca_1', currency, purpose: 'company', status: 'open', name: '', balance_minor: 0, test_minor: 0, live_minor: 0 }] })
      case 'GET /api/wallets/capabilities':
        return json({ capabilities: [{ capability: 'spend_on_talyvor', label: 'sandbox' }] })
      case 'GET /api/pricing':
        return json({ min_usd_cents: 0, max_usd_cents: 0, preset_usd_cents: [], ladders: LADDERS, fees: FEES })
      case 'GET /api/plan':
        return json(plan)
      case 'PUT /api/plan':
        puts.push(JSON.parse(init.body as string))
        return json(change?.body ?? {}, change?.status ?? 200)
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return puts
}

const ladderNames = async () => within(await screen.findByTestId('plan-ladder')).getAllByRole('header').map((h) => h.props.children)

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

test('a Personal account opens Plan from Settings and sees exactly Solo, Crew and Fleet, with Lens’s figures in its own currency', async () => {
  mockBff(PERSONAL)
  await renderRouter('./src/app', { initialUrl: '/settings' })
  await fireEvent.press(await screen.findByText('Plan'))
  expect(await ladderNames()).toEqual(['Solo', 'Crew', 'Fleet'])
  expect(screen.getByText(WEB.forPerson)).toBeTruthy()

  const current = within(screen.getByTestId('plan-current'))
  expect(current.getByText('You are on Crew.')).toBeTruthy()
  expect(current.getByLabelText('£4.12')).toBeTruthy()
  expect(current.getByText('5 of 11')).toBeTruthy()
  expect(current.getByText('0.45% on exchange')).toBeTruthy()
  expect(await current.findByText(WEB.sandbox)).toBeTruthy()
  expect(within(screen.getByTestId('plan-head')).getByTestId('money-label-sandbox')).toBeTruthy()

  const fleet = within(screen.getByTestId('ladder-personal_fleet'))
  expect(fleet.getByLabelText('£8.12')).toBeTruthy()
  expect(fleet.getByText('27 agents')).toBeTruthy()
  expect(fleet.getByText('No exchange fee')).toBeTruthy()
  expect(fleet.getByText(WEB.change)).toBeTruthy()
  const crew = within(screen.getByTestId('ladder-personal_crew'))
  expect(crew.getByText('Your plan')).toBeTruthy()
  expect(crew.queryByText(WEB.change)).toBeNull()
  expect(screen.queryByText(/LXC|Team|Free/)).toBeNull()
})

test('a Business sees Studio, Company, Group and Custom, which is talked about and never changed to', async () => {
  mockBff(BUSINESS, { currency: 'EUR' })
  await renderRouter('./src/app', { initialUrl: '/settings/plan' })
  expect(await ladderNames()).toEqual(['Studio', 'Company', 'Group', 'Custom'])
  expect(screen.getByText(WEB.forCompany)).toBeTruthy()
  const current = within(screen.getByTestId('plan-current'))
  expect(current.getByText('You are on Company.')).toBeTruthy()
  expect(current.getByLabelText('€37.00')).toBeTruthy()
  expect(current.getByText('2 of 26')).toBeTruthy()
  expect(current.getByText('6 people')).toBeTruthy()
  const group = within(screen.getByTestId('ladder-business_group'))
  expect(group.getByLabelText('€127.00')).toBeTruthy()
  expect(group.getByText('Unlimited agents')).toBeTruthy()
  const custom = within(screen.getByTestId('ladder-business_custom'))
  expect(custom.getByText('By contract')).toBeTruthy()
  expect(custom.getByText(WEB.custom)).toBeTruthy()
  expect(custom.queryByText(WEB.change)).toBeNull()
})

test('a change Lens refuses asks once, sends the plan, and says Lens’s sentence; nothing else changes', async () => {
  const sentence = 'This account has 5 agents and Solo takes 4. Archive one first.'
  const puts = mockBff(PERSONAL, { change: { status: 409, body: { error: sentence } } })
  await renderRouter('./src/app', { initialUrl: '/settings/plan' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Change plan: Solo' }))
  const sheet = within(await screen.findByTestId('plan-change-sheet'))
  expect(sheet.getByText('Change to Solo?')).toBeTruthy()
  expect(sheet.getByText('You pay £0.00 a month instead of £4.12.')).toBeTruthy()
  expect(sheet.getByText('4 agents instead of 11 agents.')).toBeTruthy()
  expect(puts).toEqual([])

  await fireEvent.press(sheet.getByRole('button', { name: 'Change to Solo' }))
  await waitFor(() => expect(sheet.getByTestId('plan-change-refusal')).toBeTruthy())
  expect(sheet.getByText(sentence)).toBeTruthy()
  expect(puts).toEqual([{ plan: 'personal_solo' }])
  expect(screen.queryByTestId('plan-changed')).toBeNull()
})

test('a change Lens takes closes the sheet and says the account is on its new plan', async () => {
  const puts = mockBff(PERSONAL, { change: { status: 200, body: { from: 'personal_crew', plan: 'personal_fleet', name: 'Fleet' } } })
  await renderRouter('./src/app', { initialUrl: '/settings/plan' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Change plan: Fleet' }))
  await fireEvent.press(within(await screen.findByTestId('plan-change-sheet')).getByRole('button', { name: 'Change to Fleet' }))
  const done = within(await screen.findByTestId('plan-changed'))
  expect(done.getByText('You are on Fleet')).toBeTruthy()
  expect(done.getByText('Your plan changed now.')).toBeTruthy()
  expect(screen.queryByTestId('plan-change-sheet')).toBeNull()
  expect(puts).toEqual([{ plan: 'personal_fleet' }])
})

// B57.180 — Plan drawn in Pocket, as Pocket Live's Settings sub-pages and the app's Wallets draw theirs: the Sandbox label
// beside the headline rather than inside the card, the plan's facts with their label on the left and the figure on the
// right, the ladder under its section head, and the change sheet as Pocket's sheet with the label beside its question.
test('Plan is drawn in Pocket: the label beside the headline, label-left facts, the section head, and the sheet with its label', async () => {
  mockBff(PERSONAL)
  await renderRouter('./src/app', { initialUrl: '/settings/plan' })
  const head = within(await screen.findByTestId('plan-head'))
  expect(head.getByText('Plan')).toBeTruthy()
  expect(await head.findByTestId('money-label-sandbox')).toBeTruthy()
  expect(within(screen.getByTestId('plan-current')).queryByTestId('money-label-sandbox')).toBeNull()

  expect(screen.getByLabelText('Agents: 5 of 11')).toBeTruthy()
  expect(screen.getByLabelText('People: 1 person')).toBeTruthy()
  expect(screen.getByLabelText('Exchange: 0.45% on exchange')).toBeTruthy()
  expect(screen.getByRole('header', { name: WEB.forPerson })).toBeTruthy()

  await fireEvent.press(await screen.findByRole('button', { name: 'Change plan: Fleet' }))
  const sheet = within(await screen.findByTestId('plan-change-sheet'))
  expect(await sheet.findByTestId('money-label-sandbox')).toBeTruthy()
  expect(sheet.getByRole('button', { name: 'Close' })).toBeTruthy()
})
