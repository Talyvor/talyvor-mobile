import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

// B59.33 — Wallets on the phone: what each account holds, by the workspace's kind of money (SPEC 3.3). Fiat only shows
// the fiat side, Stablecoin and crypto only the stablecoin side, Hybrid both side by side; a side the kind does not have
// is not rendered. Home's total opens it.

jest.setTimeout(60_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
jest.mock('../../modules/talyvor-keys', () => ({ isAvailable: () => true, sign: async () => '', deleteKey: async () => undefined }))

type Kind = 'fiat' | 'stablecoin' | 'hybrid'

// The company's accounts and Research's, in both kinds of money: Lens keeps what a workspace held before its kind changed.
const accounts = [
  { id: 'acc_usd', currency: 'USD', purpose: 'company', status: 'open', name: 'The company · USD', balance_minor: 240_000 },
  { id: 'acc_gbp', currency: 'GBP', purpose: 'company', status: 'open', name: 'The company · GBP', balance_minor: 156_000 },
  { id: 'acc_usdc', currency: 'USDC', purpose: 'company', status: 'open', name: 'The company · USDC', balance_minor: 14_000_000_000 },
  { id: 'acc_r_usd', agent_id: 'ag_1', currency: 'USD', purpose: 'agent', status: 'open', name: 'Research · USD', balance_minor: 40_000 },
  { id: 'acc_r_usdc', agent_id: 'ag_1', currency: 'USDC', purpose: 'agent', status: 'open', name: 'Research · USDC', balance_minor: 1_500_000_000 },
]

function mockBff(money_kind: Kind) {
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path] = url.replace('https://bff.test', '').split('?')
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    switch (`${init.method ?? 'GET'} ${path}`) {
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
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

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
  fireEvent.press(await screen.findByRole('link', { name: 'See all in Wallets' }))
  expect(await screen.findByLabelText('The company · USD, $2,400.00')).toBeTruthy()
})
