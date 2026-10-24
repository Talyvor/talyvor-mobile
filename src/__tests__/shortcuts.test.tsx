import { renderRouter, screen, waitFor } from 'expo-router/testing-library'

import shortcuts from '../../plugins/shortcuts.json'

// B40.17 DONE: each shortcut opens its screen, and "Pay my bills in Talyvor" lands on the approval card for the bills
// due without paying anything.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-widgets', () => ({ createWidget: () => ({ updateSnapshot: () => undefined }) }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

const { swiftSource, shortcutsXml } = jest.requireActual('../../plugins/with-app-shortcuts.js')

/** The BFF with one request of two bills waiting for approval; any other call answers 404. */
function mockBff() {
  const calls: string[] = []
  const request = {
    id: 'preq_1',
    status: 'pending_approval',
    summary: 'Bills due Friday',
    client: 'mcp:claude',
    totals: { GBP: 3400 },
    items: [
      { position: 1, payee_id: 'py_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 2500, reference: 'Oct', decision: 'needs_approval', reason: 'a new payee' },
      { position: 2, payee_id: 'py_2', payee_name: 'Bolt Couriers', currency: 'GBP', amount_minor: 900, reference: 'Run 4', decision: 'needs_approval', reason: 'above 5.00 GBP' },
    ],
    created_at: '2026-10-24T08:00:00Z',
  }
  const routes: Record<string, unknown> = {
    'GET /api/money/payment-requests?status=pending_approval': { requests: [request] },
    'GET /api/money/payment-requests/preq_1': request,
    'GET /api/agents': { workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] },
  }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    calls.push(route)
    return new Response(JSON.stringify(routes[route] ?? { error: 'no' }), { status: route in routes ? 200 : 404 })
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

const opens: Record<string, string> = {
  whats_due: '2 payments waiting for you',
  pay_bills: 'Bills due Friday',
  pause_agents: 'Pause every agent?',
  approve: 'What your agents asked for',
  agent_spend: 'This month',
}

test.each(shortcuts.map((s) => [s.id, s.url]))('the %s shortcut opens %s at its screen', async (id, url) => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: url.replace('talyvor://', '/') })
  expect(await screen.findByText(opens[id])).toBeTruthy()
})

test('every shortcut is in the iOS and the Android build, and each Siri phrase says the app name', () => {
  const swift = swiftSource(shortcuts)
  const xml = shortcutsXml(shortcuts, 'com.talyvor.app')
  expect(shortcuts.length).toBeLessThanOrEqual(10)
  for (const s of shortcuts) {
    expect(swift).toContain(`phrases: ["${s.phrase} \\(.applicationName)"]`)
    expect(swift).toContain(`OpenURLIntent(URL(string: "${s.url}")!)`)
    expect(xml).toContain(`android:data="${s.url.replace(/&/g, '&amp;')}"`)
  }
  expect(swift).toMatch(/struct PayBillsIntent[^}]*authenticationPolicy: IntentAuthenticationPolicy = \.requiresAuthentication/)
})

test('"Pay my bills" lands on the approval card of the bills due and pays nothing', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/bills?pay=1' })
  expect(await screen.findByText('Bills due Friday')).toBeTruthy()
  expect(screen.getByText(/^2 of 2 payments to approve, total/)).toBeTruthy()
  expect(screen.getByText('Approve 2 payments with Face ID')).toBeTruthy()
  await waitFor(() => expect(calls).toContain('GET /api/money/payment-requests/preq_1'))
  expect(calls.filter((c) => c.startsWith('POST'))).toEqual([])
})
