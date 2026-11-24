import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B59.50 — Settings' Team and roles on the phone: a Business owner sees and sets the second approver, an Approver or
// Admin who has signed in and the amount above which a payment needs two approvals (Lens B28.315), signed with this
// phone's key over Lens's challenge for exactly that line. A Personal account never sees it and never asks for it.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))
const mockSigned: string[] = []
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_alias: string, message: string) => {
    mockSigned.push(message)
    return 'sig'
  },
  deleteKey: async () => undefined,
}))

/** The web's strings, typed from suite 7c30803 (apps/web/src/areas/lens/TeamRoles.tsx SecondApprover, B28.40): the
 * phone is checked against these, not against its own copy. */
const WEB = {
  title: 'Second approver',
  line: 'Above an amount you choose, a payment needs two people to approve it, and one of them is your second approver.',
  none: 'No second approver: one approval is enough.',
  nobody: 'Give someone the Approver or Admin role. Once they have signed in, you can pick them here.',
  saved: 'Second approver saved',
  savedLine: 'Above £5,000.00, a payment needs two approvals.',
  removed: 'Second approver removed',
  removedLine: 'One approval is enough again.',
  above: 'Above £5,000.00',
}

const role = (email: string, r: string, user_id = '') => ({ email, role: r, signed_in: !!user_id, granted_at: '2026-11-20T09:00:00Z', user_id })
const TEAM = [
  role('ada@northwind.studio', 'approver', 'u_ada'),
  role('bo@northwind.studio', 'admin', 'u_bo'),
  role('fin@northwind.studio', 'finance', 'u_fin'),
  role('new@northwind.studio', 'approver'),
]
const EMPTY = { user_id: '', above_minor: 0, currency: '' }

function mockBff({ type = 'business', team = TEAM, line = EMPTY }: { type?: 'business' | 'personal'; team?: unknown[]; line?: typeof EMPTY } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  let held = line
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, path, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type: type, money_kind: 'fiat' })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/members':
        return json([{ id: 'm_1', name: 'Nick', email: 'nick@northwind.studio', role: 'owner', avatar_url: '' }])
      case 'GET /api/workspace/roles':
        return json({ items: team })
      case 'GET /api/workspace/second-approver':
        if (type === 'personal') return json({ error: 'a Personal account has no second approver', code: 'not_business' }, 404)
        return json(held)
      case 'POST /api/workspace/second-approver/challenge':
        return json({ challenge: 'ch_line', allow_credentials: [] })
      case 'PUT /api/workspace/second-approver': {
        const { user_id, above_minor, currency } = body as typeof EMPTY
        held = { user_id, above_minor, currency }
        return json(held)
      }
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  mockStore.clear()
  mockSigned.length = 0
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dev_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
})

const writes = (calls: { method: string; path: string; body?: unknown }[]) =>
  calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/api/workspace/second-approver')).map((c) => [c.method, c.path, c.body])

test('a Business picks a signed-in Approver or Admin, and sets the line signed with this phone’s key, in the web’s words', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/settings' })
  const card = within(await screen.findByTestId('second-approver'))
  expect(card.getByText(WEB.title)).toBeTruthy()
  expect(card.getByText(WEB.line)).toBeTruthy()
  expect(await card.findByText(WEB.none)).toBeTruthy()
  // Only a signed-in Approver or Admin: Finance cannot approve, and an Approver who has not signed in has no user id yet.
  expect(card.getByRole('radio', { name: 'ada@northwind.studio · Approver' })).toBeTruthy()
  expect(card.getByRole('radio', { name: 'bo@northwind.studio · Admin' })).toBeTruthy()
  expect(card.queryByText(/fin@northwind\.studio/)).toBeNull()
  expect(card.queryByText(/new@northwind\.studio/)).toBeNull()

  await fireEvent.changeText(card.getByLabelText('Above'), '5000')
  await fireEvent.press(card.getByTestId('second-approver-save'))
  expect(await screen.findByText(WEB.saved)).toBeTruthy()
  expect(screen.getByText(WEB.savedLine)).toBeTruthy()
  const set = { user_id: 'u_ada', above_minor: 500_000, currency: 'GBP' }
  expect(writes(calls)).toEqual([
    ['POST', '/api/workspace/second-approver/challenge', set],
    ['PUT', '/api/workspace/second-approver', { ...set, assertion: { device_id: 'dev_1', challenge: 'ch_line', signature: 'sig' } }],
  ])
  expect(mockSigned).toEqual(['talyvor-device-v1:ch_line'])
  const now = within(await screen.findByTestId('second-approver-now'))
  expect(now.getByText('ada@northwind.studio')).toBeTruthy()
  expect(now.getByText(WEB.above)).toBeTruthy()
})

test('Remove clears the line, signed the same way', async () => {
  const calls = mockBff({ line: { user_id: 'u_bo', above_minor: 500_000, currency: 'GBP' } })
  await renderRouter('./src/app', { initialUrl: '/settings' })
  const now = within(await screen.findByTestId('second-approver-now'))
  expect(now.getByText('bo@northwind.studio')).toBeTruthy()
  expect(now.getByText(WEB.above)).toBeTruthy()
  await fireEvent.press(now.getByText('Remove'))
  expect(await screen.findByText(WEB.removed)).toBeTruthy()
  expect(screen.getByText(WEB.removedLine)).toBeTruthy()
  expect(writes(calls)).toEqual([
    ['POST', '/api/workspace/second-approver/challenge', EMPTY],
    ['PUT', '/api/workspace/second-approver', { ...EMPTY, assertion: { device_id: 'dev_1', challenge: 'ch_line', signature: 'sig' } }],
  ])
  expect(await screen.findByText(WEB.none)).toBeTruthy()
})

test('with nobody to pick, it says how to get someone, and offers no Save', async () => {
  mockBff({ team: [role('new@northwind.studio', 'approver'), role('fin@northwind.studio', 'finance', 'u_fin')] })
  await renderRouter('./src/app', { initialUrl: '/settings' })
  const card = within(await screen.findByTestId('second-approver'))
  expect(await card.findByText(WEB.nobody)).toBeTruthy()
  expect(card.queryByTestId('second-approver-save')).toBeNull()
})

test('a Personal account never sees the second approver and never asks for it', async () => {
  const calls = mockBff({ type: 'personal' })
  await renderRouter('./src/app', { initialUrl: '/settings' })
  expect(await screen.findByTestId('security-keys')).toBeTruthy()
  await waitFor(() => expect(calls.some((c) => c.path === '/api/workspace/account')).toBe(true))
  expect(screen.queryByTestId('second-approver')).toBeNull()
  expect(screen.queryByText(WEB.title)).toBeNull()
  expect(calls.some((c) => c.path.startsWith('/api/workspace/second-approver') || c.path === '/api/workspace/roles')).toBe(false)
})
