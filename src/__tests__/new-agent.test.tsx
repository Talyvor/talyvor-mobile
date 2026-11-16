import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

// B61.37 — New agent on the phone, as the web's (suite B61.13): from Agents, one of Talyvor's six named by what it does,
// or your own; the owner types the name, and Continue stays off until they do; then the four rules in the account's
// currency, which Lens is sent exactly as typed, signed with this phone's key when Lens judges the save looser.

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
const mockSign = jest.fn(async () => 'sig')
jest.mock('../../modules/talyvor-keys', () => ({ isAvailable: () => true, sign: (...a: unknown[]) => mockSign(...(a as [])) }))

/** The helpers' own names: never an agent's, and never offered as one. */
const HELPERS = /Remy|Sunny|Penny|\bMax\b|Nova|Ollie/

function mockBff({ looser = false, currency = 'GBP' } = {}) {
  const bodies: Record<string, unknown> = {}
  const made = { id: 'ag_new', name: '', colour: '', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-11-16T00:00:00Z' }
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
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/accounts':
        return json({ accounts: [{ id: 'ca_1', purpose: 'company', currency, status: 'open', balance_minor: 0 }] })
      case 'GET /api/workspace/account':
        return json({ workspace_id: 'ws_1', account_type: 'personal', money_kind: 'fiat' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Nora Vance' })
      case 'POST /api/agents': {
        const b = bodies[route] as { name: string; colour: string }
        Object.assign(made, { name: b.name, colour: b.colour })
        return json(made)
      }
      case 'PATCH /api/agents/ag_new':
        return json({ ...made, description: (bodies[route] as { description: string }).description })
      case 'POST /api/agents/ag_new/rules-challenge':
        return json(looser ? { looser: true, challenge: 'ch_1', changes: [], allow_credentials: [] } : { looser: false, changes: [], allow_credentials: [] })
      case 'PUT /api/agents/ag_new/rules':
        return json(bodies[route])
    }
    return json({ error: 'not found' }, 404)
  }) as unknown as typeof fetch
  return bodies
}

beforeEach(() => {
  mockStore.clear()
  mockSign.mockClear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

const disabled = (label: string) => screen.getByRole('button', { name: label }).props.accessibilityState?.disabled === true

/** A limit on the third step: its row opens its sheet, the amount is typed there and saved. */
async function setRule(row: RegExp, field: string, value: string) {
  await fireEvent.press(screen.getByRole('button', { name: row }))
  await fireEvent.changeText(await screen.findByLabelText(field), value)
  await fireEvent.press(screen.getByText('Save'))
  await waitFor(() => expect(screen.queryByTestId('new-agent-rule')).toBeNull())
}

async function openNewAgent() {
  await renderRouter('./src/app', { initialUrl: '/agents' })
  await fireEvent.press(await screen.findByText('New agent'))
  expect(await screen.findByText('Which agent?')).toBeTruthy()
}

test('one of ours: named by what it does, the owner types the name, and its suggested rules are sent in pounds as shown', async () => {
  const bodies = mockBff()
  await openNewAgent()
  expect(screen.queryByText(HELPERS)).toBeNull()
  expect(disabled('Continue')).toBe(true)
  await fireEvent.press(screen.getByRole('radio', { name: /^Travel\./ }))
  await fireEvent.press(screen.getByText('Continue'))
  expect(await screen.findByText('Name your agent')).toBeTruthy()
  // The name is the owner's: empty, never filled with a helper's or the kind's, and Continue waits for it.
  const name = screen.getByLabelText('Its name')
  expect(name.props.value).toBe('')
  expect(disabled('Continue')).toBe(true)
  await fireEvent.changeText(name, 'Trips')
  await fireEvent.press(screen.getByText('Continue'))
  expect(await screen.findByText('Set Trips’s limits')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Per payment, £1,500.00' })).toBeTruthy()
  await setRule(/^Per payment,/, 'Per payment, in pounds', '12.50')
  expect(screen.queryByText(HELPERS)).toBeNull()
  await fireEvent.press(screen.getByText('Create agent'))
  await waitFor(() => expect(screen).toHavePathname('/agents/ag_new'))
  expect(bodies['POST /api/agents']).toEqual({ name: 'Trips', colour: 'sky', fiat_currency: 'GBP' })
  expect(bodies['PATCH /api/agents/ag_new']).toEqual({ description: 'Travel' })
  expect(bodies['PUT /api/agents/ag_new/rules']).toMatchObject({ currency: 'GBP', max_per_payment_minor: 1_250, daily_limit_minor: 300_000, monthly_limit_minor: 600_000, approval_above_minor: 50_000 })
  expect(mockSign).not.toHaveBeenCalled()
})

test('your own: its name, what it does and its picture, and the four rules read back exactly as typed, signed with Face ID when looser', async () => {
  mockStore.set('talyvor.device-key', 'dev_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
  const bodies = mockBff({ looser: true, currency: 'USD' })
  await openNewAgent()
  await fireEvent.press(screen.getByRole('radio', { name: /^Your own\./ }))
  await fireEvent.press(screen.getByText('Continue'))
  expect(await screen.findByText('Make it yours')).toBeTruthy()
  await fireEvent.changeText(screen.getByLabelText('Its name'), 'Atlas')
  await fireEvent.changeText(screen.getByLabelText('What it does'), 'Gifts')
  await fireEvent.press(screen.getByRole('radio', { name: 'Picture 4' }))
  await fireEvent.press(screen.getByText('Continue'))
  expect(await screen.findByText('Set Atlas’s limits')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Per day, None' })).toBeTruthy()
  await setRule(/^Per payment,/, 'Per payment, in dollars', '50')
  await setRule(/^Per day,/, 'Per day, in dollars', '200')
  await setRule(/^Per month,/, 'Per month, in dollars', '1000')
  await setRule(/^Ask me above,/, 'Ask me above, in dollars', '20')
  await fireEvent.press(screen.getByText('Create agent'))
  await waitFor(() => expect(screen).toHavePathname('/agents/ag_new'))
  expect(bodies['POST /api/agents']).toEqual({ name: 'Atlas', colour: 'lemon', fiat_currency: 'USD' })
  expect(bodies['PATCH /api/agents/ag_new']).toEqual({ description: 'Gifts' })
  const saved = bodies['PUT /api/agents/ag_new/rules'] as { rules: Record<string, unknown>; assertion: Record<string, unknown> }
  expect(saved.rules).toMatchObject({ currency: 'USD', max_per_payment_minor: 5_000, daily_limit_minor: 20_000, monthly_limit_minor: 100_000, approval_above_minor: 2_000, hourly_limit_minor: 0, weekly_limit_minor: 0 })
  expect(saved.assertion).toEqual({ device_id: 'dev_1', challenge: 'ch_1', signature: 'sig' })
  expect(mockSign).toHaveBeenCalledTimes(1)
})

test('with no rule typed, the screen says every payment waits for your yes, and Lens is told to ask above one penny', async () => {
  const bodies = mockBff()
  await openNewAgent()
  await fireEvent.press(screen.getByRole('radio', { name: /^Your own\./ }))
  await fireEvent.press(screen.getByText('Continue'))
  await fireEvent.changeText(await screen.findByLabelText('Its name'), 'Atlas')
  await fireEvent.press(screen.getByText('Continue'))
  expect(await screen.findByTestId('new-agent-every-payment')).toBeTruthy()
  await fireEvent.press(screen.getByText('Create agent'))
  await waitFor(() => expect(screen).toHavePathname('/agents/ag_new'))
  expect(bodies['POST /api/agents']).toEqual({ name: 'Atlas', colour: 'cobalt', fiat_currency: 'GBP' })
  expect(bodies['PATCH /api/agents/ag_new']).toBeUndefined()
  expect(bodies['PUT /api/agents/ag_new/rules']).toMatchObject({ currency: 'GBP', max_per_payment_minor: 0, daily_limit_minor: 0, monthly_limit_minor: 0, approval_above_minor: 1 })
})

// B57.178 — New agent as Pocket Live draws it (`na` 0 to 2): the three step bars without words, the back arrow alone, and
// the limits as a card of rows, each its amount in the account's currency and opening its own sheet to change it.
test('B57.178 the limits are rows that each open a sheet, and the screen reads as Pocket Live draws it', async () => {
  const bodies = mockBff()
  await openNewAgent()
  expect(screen.queryByText(/^Step \d of 3$/)).toBeNull()
  expect(screen.getByLabelText('Step 1 of 3')).toBeTruthy()
  expect(screen.queryByText('Back')).toBeNull()
  expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  await fireEvent.press(screen.getByRole('radio', { name: /^Travel\./ }))
  await fireEvent.press(screen.getByText('Continue'))
  await fireEvent.changeText(await screen.findByLabelText('Its name'), 'Trips')
  await fireEvent.press(screen.getByText('Continue'))
  expect(await screen.findByText('Set Trips’s limits')).toBeTruthy()
  // Each rule a row with its amount, none a field on the screen itself.
  expect(screen.queryByLabelText('Per payment, in pounds')).toBeNull()
  expect(screen.getByRole('button', { name: 'Per payment, £1,500.00' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Per day, £3,000.00' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Per month, £6,000.00' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Ask me above, £500.00' })).toBeTruthy()
  expect(screen.getByText('You can change these any time on the agent’s page.')).toBeTruthy()
  // Per payment's sheet: its name, what it means, the amount in pounds and Save; a word that is not an amount is not saved.
  await fireEvent.press(screen.getByRole('button', { name: 'Per payment, £1,500.00' }))
  expect(await screen.findByText('The most it can pay per payment')).toBeTruthy()
  await fireEvent.changeText(screen.getByLabelText('Per payment, in pounds'), 'lots')
  expect(disabled('Save')).toBe(true)
  await fireEvent.changeText(screen.getByLabelText('Per payment, in pounds'), '12.50')
  await fireEvent.press(screen.getByText('Save'))
  expect(await screen.findByRole('button', { name: 'Per payment, £12.50' })).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'Ask me above, £500.00' }))
  expect(await screen.findByText('A payment above this waits for your yes')).toBeTruthy()
  await fireEvent.changeText(screen.getByLabelText('Ask me above, in pounds'), '')
  await fireEvent.press(screen.getByText('Save'))
  expect(await screen.findByRole('button', { name: 'Ask me above, None' })).toBeTruthy()
  await fireEvent.press(screen.getByText('Create agent'))
  await waitFor(() => expect(screen).toHavePathname('/agents/ag_new'))
  expect(bodies['PUT /api/agents/ag_new/rules']).toMatchObject({ currency: 'GBP', max_per_payment_minor: 1_250, daily_limit_minor: 300_000, monthly_limit_minor: 600_000, approval_above_minor: 0 })
})

// B61.103 — your own picks from the web's gallery of 27 (the six's faces, lime's and the twenty drawn ones): the chef is
// sent as its picture, in its own lemon, and is what the new agent is drawn with.
test('B61.103 the gallery offers 27 pictures, and choosing the chef sends picture chef in its colour', async () => {
  const bodies = mockBff()
  await openNewAgent()
  await fireEvent.press(screen.getByRole('radio', { name: /^Your own\./ }))
  await fireEvent.press(screen.getByText('Continue'))
  await fireEvent.changeText(await screen.findByLabelText('Its name'), 'Supper')
  expect(screen.getAllByRole('radio', { name: /^Picture \d+$/ }).map((r) => r.props.accessibilityLabel)).toEqual(Array.from({ length: 27 }, (_, i) => `Picture ${i + 1}`))
  expect(screen.queryByText('More pictures are being drawn.')).toBeNull()
  await fireEvent.press(screen.getByRole('radio', { name: 'Picture 20' }))
  expect(screen.getByRole('radio', { name: 'Picture 20' }).props.accessibilityState).toEqual({ checked: true })
  expect(screen.getAllByTestId('face-picture-chef-happy')).toHaveLength(2)
  expect(screen.queryByText(HELPERS)).toBeNull()
  await fireEvent.press(screen.getByText('Continue'))
  await fireEvent.press(await screen.findByText('Create agent'))
  await waitFor(() => expect(screen).toHavePathname('/agents/ag_new'))
  expect(bodies['POST /api/agents']).toEqual({ name: 'Supper', colour: 'lemon', picture: 'chef', fiat_currency: 'GBP' })
})
