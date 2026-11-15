import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B59.33 — Wallets on the phone: what each account holds, by the workspace's kind of money (SPEC 3.3). Fiat only shows
// the fiat side, Stablecoin and crypto only the stablecoin side, Hybrid both side by side; a side the kind does not have
// is not rendered. Home's total opens it. Top up, Withdraw and, for Hybrid, Convert (the web's B59.53, with its words):
// each has a confirm step, nothing is sent before it, and Withdraw and Convert are signed with this phone's key over Lens's
// challenge, under the same Idempotency-Key.

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
const mockSigned: string[] = []
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_alias: string, message: string) => {
    mockSigned.push(message)
    return 'sig'
  },
  deleteKey: async () => undefined,
}))

type Kind = 'fiat' | 'stablecoin' | 'hybrid'

// The company's accounts and Research's, in both kinds of money: Lens keeps what a workspace held before its kind changed.
const accounts = [
  { id: 'acc_usd', currency: 'USD', purpose: 'company', status: 'open', name: 'The company · USD', balance_minor: 240_000 },
  { id: 'acc_gbp', currency: 'GBP', purpose: 'company', status: 'open', name: 'The company · GBP', balance_minor: 156_000 },
  { id: 'acc_usdc', currency: 'USDC', purpose: 'company', status: 'open', name: 'The company · USDC', balance_minor: 14_000_000_000 },
  { id: 'acc_r_usd', agent_id: 'ag_1', currency: 'USD', purpose: 'agent', status: 'open', name: 'Research · USD', balance_minor: 40_000 },
  { id: 'acc_r_usdc', agent_id: 'ag_1', currency: 'USDC', purpose: 'agent', status: 'open', name: 'Research · USDC', balance_minor: 1_500_000_000 },
]

const payees = [
  { id: 'pe_own', name: 'Ada Lovelace', country: 'GB', needs_confirmation: false, iban: 'GB29NWBK60161331929911', own: true, created_at: '' },
  { id: 'pe_other', name: 'Acme Ltd', country: 'GB', needs_confirmation: false, iban: 'GB29NWBK60161331920000', created_at: '' },
]

const quote = { id: 'cq_1', sell_minor: 10_000, sell_currency: 'USD', margin_minor: 0, buy_minor: 100_000_000, buy_currency: 'USDC', rate: '1', status: 'quoted', expires_at: '2099-01-01T00:00:00Z' }

/** Every write the screen sent: its method and path, its body and its Idempotency-Key. */
let writes: { call: string; body: unknown; key: string | undefined }[] = []

function mockBff(money_kind: Kind) {
  writes = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path] = url.replace('https://bff.test', '').split('?')
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    const call = `${init.method ?? 'GET'} ${path}`
    if (init.method === 'POST') writes.push({ call, body: init.body ? JSON.parse(String(init.body)) : undefined, key: (init.headers as Record<string, string>)['Idempotency-Key'] })
    switch (call) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'business', money_kind })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/money/accounts':
        return json({ accounts })
      case 'GET /api/money/devices':
        return json({ devices: [{ id: 'dev_1', platform: 'ios', name: 'iPhone', created_at: '2026-11-01T00:00:00Z' }] })
      case 'GET /api/money/payees':
        return json({ payees })
      case 'POST /api/money/accounts/acc_usd/top-up':
        return json({ id: 'tm_1' })
      case 'POST /api/money/accounts/acc_usd/withdraw/challenge':
        return json({ challenge: 'ch_withdraw', allow_credentials: [] })
      case 'POST /api/money/accounts/acc_usd/withdraw':
        return json({ id: 'op_1', status: 'pending' })
      case 'POST /api/money/convert/quote':
        return json(quote)
      case 'POST /api/money/convert/challenge':
        return json({ challenge: 'ch_convert', allow_credentials: [] })
      case 'POST /api/money/convert':
        return json({ ...quote, status: 'converted' })
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockStore.clear()
  mockSigned.length = 0
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

/** This phone holds the workspace's approval key. */
function phoneHoldsTheKey() {
  mockStore.set('talyvor.device-key', 'dev_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
}

test('Fiat only: the fiat side, each account in it, and no stablecoin', async () => {
  mockBff('fiat')
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  expect(await screen.findByText('Fiat')).toBeTruthy()
  expect(screen.getByLabelText('US dollar, $2,800.00')).toBeTruthy()
  expect(screen.getByLabelText('British pound, £1,560.00')).toBeTruthy()
  expect(screen.getByLabelText('The company · USD, $2,400.00')).toBeTruthy()
  expect(screen.getByLabelText('Research · USD, $400.00')).toBeTruthy()
  expect(screen.queryByText('Stablecoin')).toBeNull()
  expect(screen.queryByText(/USDC/)).toBeNull()
})

test('Stablecoin and crypto only: the stablecoin side, and no fiat', async () => {
  mockBff('stablecoin')
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  expect(await screen.findByText('Stablecoin')).toBeTruthy()
  expect(screen.getByLabelText('USDC, 15,500.00 USDC')).toBeTruthy()
  expect(screen.getByLabelText('Research · USDC, 1,500.00 USDC')).toBeTruthy()
  expect(screen.queryByText('Fiat')).toBeNull()
  expect(screen.queryByText(/\$|£/)).toBeNull()
})

test('Hybrid: both sides, fiat first', async () => {
  mockBff('hybrid')
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  expect(await screen.findByText('Fiat')).toBeTruthy()
  expect(screen.getByText('Stablecoin')).toBeTruthy()
  expect(screen.getByLabelText('US dollar, $2,800.00')).toBeTruthy()
  expect(screen.getByLabelText('USDC, 15,500.00 USDC')).toBeTruthy()
  expect(screen.getAllByText(/^(Fiat|Stablecoin)$/).map((t) => t.props.children)).toEqual(['Fiat', 'Stablecoin'])
})

test("Home's total opens Wallets", async () => {
  mockBff('hybrid')
  await renderRouter('./src/app', { initialUrl: '/' })
  await fireEvent.press(await screen.findByRole('link', { name: 'See all in Wallets' }))
  expect(await screen.findByLabelText('The company · USD, $2,400.00')).toBeTruthy()
})

test.each([
  ['fiat', ['Top up', 'Withdraw']],
  ['stablecoin', ['Top up']],
  ['hybrid', ['Top up', 'Withdraw', 'Convert']],
] as const)('the actions by kind: %s has %j', async (kind, shown) => {
  phoneHoldsTheKey()
  mockBff(kind)
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  expect(await screen.findByRole('button', { name: 'Top up' })).toBeTruthy()
  expect(['Top up', 'Withdraw', 'Convert'].filter((w) => screen.queryByRole('button', { name: w }) !== null)).toEqual(shown)
})

test('Top up: the confirm step first, then Face ID, then Sandbox money once under its key', async () => {
  phoneHoldsTheKey()
  mockBff('fiat')
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Top up' }))
  await fireEvent.changeText(screen.getByLabelText('Amount'), '50')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  const confirm = within(await screen.findByTestId('top-up-confirm'))
  expect(confirm.getByText('$50.00')).toBeTruthy()
  expect(confirm.getByText('The company · USD')).toBeTruthy()
  expect(writes).toEqual([])
  await fireEvent.press(screen.getByRole('button', { name: 'Top up with Face ID' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toEqual({ call: 'POST /api/money/accounts/acc_usd/top-up', body: { amount_minor: 5000 }, key: expect.stringMatching(/.+/) })
  expect(mockSigned).toHaveLength(1)
  await waitFor(() => expect(screen.queryByTestId('top-up-confirm')).toBeNull())
})

test('Withdraw: to a bank of your own only, confirmed, then signed over its challenge under one key', async () => {
  phoneHoldsTheKey()
  mockBff('fiat')
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Withdraw' }))
  expect(await screen.findByText('To your own bank')).toBeTruthy()
  expect(await screen.findByLabelText('Ada Lovelace · account ending 9911, ')).toBeTruthy()
  expect(screen.queryByText(/Acme/)).toBeNull()
  await fireEvent.changeText(screen.getByLabelText('Amount'), '25.50')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByTestId('withdraw-confirm')).toBeTruthy()
  expect(screen.getByText('$25.50')).toBeTruthy()
  expect(writes).toEqual([])
  await fireEvent.press(screen.getByRole('button', { name: 'Withdraw with Face ID' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  const body = { payee_id: 'pe_own', amount_minor: 2550 }
  expect(writes[0]).toEqual({ call: 'POST /api/money/accounts/acc_usd/withdraw/challenge', body, key: expect.stringMatching(/.+/) })
  expect(writes[1]).toEqual({
    call: 'POST /api/money/accounts/acc_usd/withdraw',
    body: { ...body, assertion: { device_id: 'dev_1', challenge: 'ch_withdraw', signature: 'sig' } },
    key: writes[0].key,
  })
  expect(mockSigned).toEqual(['talyvor-device-v1:ch_withdraw'])
})

test('Convert (Hybrid): quoted, confirmed with what you get, then signed over its challenge under one key', async () => {
  phoneHoldsTheKey()
  mockBff('hybrid')
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Convert' }))
  await fireEvent.changeText(screen.getByLabelText('Amount'), '100')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByTestId('convert-confirm')).toBeTruthy()
  expect(writes).toEqual([{ call: 'POST /api/money/convert/quote', body: { sell_currency: 'USD', buy_currency: 'USDC', sell_minor: 10_000 }, key: undefined }])
  for (const w of ['You convert', 'Rate', 'Fee', 'You get']) expect(screen.getByText(w)).toBeTruthy()
  expect(screen.getByText('1 USD = 1.0000 USDC')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'Convert with Face ID' }))
  await waitFor(() => expect(writes).toHaveLength(3))
  expect(writes[1]).toEqual({ call: 'POST /api/money/convert/challenge', body: { quote_id: 'cq_1' }, key: expect.stringMatching(/.+/) })
  expect(writes[2]).toEqual({
    call: 'POST /api/money/convert',
    body: { quote_id: 'cq_1', assertion: { device_id: 'dev_1', challenge: 'ch_convert', signature: 'sig' } },
    key: writes[1].key,
  })
})

test('without this phone\'s key the confirm step sends nothing and offers Approvals on this phone', async () => {
  mockBff('fiat')
  await renderRouter('./src/app', { initialUrl: '/wallets' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Top up' }))
  await fireEvent.changeText(screen.getByLabelText('Amount'), '50')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('button', { name: 'Approvals on this phone' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Top up with Face ID' })).toBeNull()
  expect(writes).toEqual([])
})
