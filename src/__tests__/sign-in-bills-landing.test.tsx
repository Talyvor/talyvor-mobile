import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

// B57.78 — sign-in, Bills due and an approval's landing page in Pocket's words (design/pocket p-signin, p-bills,
// p-approval-landing; journey "Bills due on the phone").

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'talyvor://auth',
  useAutoDiscovery: () => ({ authorizationEndpoint: 'https://idp/auth', tokenEndpoint: 'https://idp/token' }),
  useAuthRequest: () => [{ codeVerifier: 'verifier' }, null, async () => ({ type: 'cancel' })],
  exchangeCodeAsync: async () => ({ idToken: 'id-token-1' }),
}))

const northwind = {
  id: 'preq_northwind',
  status: 'pending_approval',
  summary: '',
  client: 'chat',
  totals: { USD: 18000 },
  items: [{ position: 1, payee_id: 'py_1', payee_name: 'Northwind Data', currency: 'USD', amount_minor: 18000, reference: 'Invoice 1042', decision: 'needs_approval', reason: '' }],
  created_at: '2026-10-22T09:31:00Z',
}
const declined = {
  id: 'apr_lead',
  agent_id: 'ag_sales',
  amount_ulxc: 900_000_000,
  model: '',
  payee: { kind: 'listing', id: 'l_1', name: 'Lead finder' },
  status: 'denied',
  created_at: '2026-10-14T07:41:00Z',
  decided_at: '2026-10-14T08:02:00Z',
  asks_above_ulxc: 500_000_000,
}

/** The BFF with the given payment requests and approvals; anything else answers 404. */
function mockBff({ requests = [northwind], approvals = [declined] }: { requests?: unknown[]; approvals?: unknown[] } = {}) {
  const routes: Record<string, unknown> = {
    'GET /api/money/payment-requests?status=pending_approval': { requests },
    'GET /api/money/payment-requests/preq_northwind': northwind,
    'GET /api/agents': { workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_sales', name: 'Sales', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] },
    'GET /api/agents/approvals': { approvals },
    'GET /api/money/payees': { payees: [] },
    'GET /api/money/payments': { payments: [] },
    'GET /api/lxc/topup-options': { usd_per_lxc: 0.1 },
  }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const body = routes[`${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`]
    return new Response(JSON.stringify(body ?? { error: 'no' }), { status: body ? 200 : 404 })
  }) as unknown as typeof fetch
}

const signedIn = () => mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))

beforeEach(() => mockStore.clear())

test('sign-in is p-signin: the logo, its headline and line, Sign in, and which account to use', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  expect(await screen.findByText('Every agent’s money, in your pocket.')).toBeTruthy()
  expect(screen.getByLabelText('Talyvor')).toBeTruthy()
  expect(screen.getByText('Approve what your agents ask for, see what each one holds, and pause one in a tap.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.getByText('Use the same account you signed up with on the web.')).toBeTruthy()
  expect(screen.queryByText('Agent wallets')).toBeNull()
})

test('Pay’s Bills due opens p-bills, whose row opens the approval card', async () => {
  signedIn()
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/pay' })
  expect(await screen.findByText('Payments prepared for you, waiting for your approval')).toBeTruthy()
  await fireEvent.press(screen.getByText('Bills due'))
  expect(await screen.findByText('Northwind Data · $180.00')).toBeTruthy()
  expect(screen.getByText('Invoice 1042 · prepared by Chat · waits for you')).toBeTruthy()
  expect(screen.getByText('Each payment prepared for you arrives as a notification that opens its approval card.')).toBeTruthy()
  await fireEvent.press(screen.getByText('Northwind Data · $180.00'))
  expect(await screen.findByText(/Approve 1 payment with/)).toBeTruthy()
})

test('p-bills with nothing due says so', async () => {
  signedIn()
  mockBff({ requests: [] })
  await renderRouter('./src/app', { initialUrl: '/bills' })
  expect(await screen.findByText('Nothing is due. A payment Chat or an assistant prepares for you waits here.')).toBeTruthy()
})

test('a decided request lands on p-approval-landing: what it was, how it ended, and the way to Approvals', async () => {
  signedIn()
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_lead' })
  expect(await screen.findByText('Sales’s request')).toBeTruthy()
  expect(screen.getByText('Lead finder · $90.00')).toBeTruthy()
  expect(screen.getByText('Declined')).toBeTruthy()
  expect(screen.getByText('A marketplace listing, above Sales’s $50.00 approval amount.')).toBeTruthy()
  expect(screen.getByText('Declined 14 Oct. Nothing is waiting for you here.')).toBeTruthy()
  expect(screen.getByText('A notification for a request still waiting opens its approval sheet. One that was decided, or expired after 24 hours, says so here.')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'Approvals' }))
  expect(await screen.findByText('What your agents asked for')).toBeTruthy()
})

test('an expired request says it expired, and why', async () => {
  signedIn()
  mockBff({ approvals: [{ ...declined, status: 'expired', decided_at: undefined, expires_at: '2026-10-15T07:41:00Z' }] })
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_lead' })
  expect(await screen.findByText('Expired 15 Oct: nobody answered within 24 hours. Nothing is waiting for you here.')).toBeTruthy()
})
