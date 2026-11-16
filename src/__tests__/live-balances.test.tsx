import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library'

// B61.95 — an account's balance on the phone is its live balance, as on the web: Lens's balance_minor is test plus live
// (B54.31), so an account holding 1.50 of test money and nothing live shows £0.00 where it is offered to pay from.

jest.setTimeout(60_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
jest.mock('../../modules/talyvor-keys', () => ({ isAvailable: () => true, sign: async () => 'sig', deleteKey: async () => undefined }))

const accounts = [{ id: 'acc_gbp', currency: 'GBP', purpose: 'company', status: 'open', name: '', balance_minor: 150, test_minor: 150, live_minor: 0 }]

function mockBff() {
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path] = url.replace('https://bff.test', '').split('?')
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${init.method ?? 'GET'} ${path}`) {
      case 'POST /api/money/people/find':
        return json({ shown_name: 'Dana R.' })
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'personal', money_kind: 'fiat' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/money/payees':
        return json({ payees: [{ id: 'py_1', name: 'Acme Hosting', country: 'GB', needs_confirmation: false, created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/payees':
        return json({ payees: [] })
      case 'GET /api/money/payments':
        return json({ payments: [] })
      case 'GET /api/money/accounts':
        return json({ accounts })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
}

/** Every word the screen draws, and every accessibility label. */
function drawn(): string {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (typeof n === 'string') out.push(n)
    else if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === 'object') {
      const label = (n as { props?: { accessibilityLabel?: unknown } }).props?.accessibilityLabel
      if (typeof label === 'string') out.push(label)
      walk((n as { children?: unknown }).children)
    }
  }
  walk(screen.toJSON())
  return out.join('\n')
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dk_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
  mockBff()
})

test("a payee's payment screen offers the account at its live balance, on the From chip and in Pay from", async () => {
  await renderRouter('./src/app', { initialUrl: '/payees/py_1' })
  const chip = await screen.findByRole('button', { name: /^From .*, £0\.00$/ })
  expect(drawn()).not.toContain('1.50')
  await fireEvent.press(chip)
  expect(screen.getAllByText('£0.00').length).toBeGreaterThan(1)
  expect(drawn()).not.toContain('1.50')
})

test('Pay a person offers the account at its live balance, on the From chip and in Pay from', async () => {
  await renderRouter('./src/app', { initialUrl: '/pay' })
  const card = within(await screen.findByTestId('pay-a-person'))
  await fireEvent.changeText(card.getByLabelText('Name, phone number or email'), 'dana')
  await fireEvent.press(card.getByRole('button', { name: 'Find' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Pay Dana R.' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'From Your account · £0.00' }))
  const from = within(await screen.findByTestId('pay-a-person-from'))
  expect(from.getByRole('button', { name: 'Your account · GBP, £0.00' })).toBeTruthy()
  expect(drawn()).not.toContain('1.50')
})
