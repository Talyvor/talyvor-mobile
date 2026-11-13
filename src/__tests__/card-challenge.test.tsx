import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

import { approvalHref } from '../push'

// B59.23: a 3-D Secure challenge on an agent's card (Lens B59.22, an approval of kind card_challenge) is the approval
// sheet with the merchant, the amount and the card. Lens takes its answer only signed, the decline too.

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
const mockPhone = { reasons: [] as string[] }
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_: string, message: string, reason: string) => {
    mockPhone.reasons.push(reason)
    return `signed:${message}`
  },
  deleteKey: async () => undefined,
}))

/** Today at 23:58 on this machine's clock, as Lens writes a time: the issuer's deadline. */
const tonight = () => {
  const t = new Date()
  t.setHours(23, 58, 0, 0)
  return t.toISOString()
}

// As Lens files it: the merchant is the payee, the card pays it in its own currency, and no rule asked.
const check = {
  id: 'apr_3ds',
  agent_id: 'ag_research',
  amount_ulxc: 1_200_000_000,
  model: '',
  payee: { kind: 'merchant', id: 'merchant:Northwind Books', name: 'Northwind Books' },
  memo: 'Confirm $120.00 by card at Northwind Books',
  status: 'pending',
  created_at: '2026-11-12T15:00:00Z',
  expires_at: tonight(),
  paid_from: { kind: 'card', account_id: 'card_1', name: 'Research’s card', currency: 'USD', amount_minor: 12_000, balance_minor: null },
  asks_above_ulxc: null,
  budget_left_after_ulxc: null,
  kind: 'card_challenge',
}

function mockBff() {
  const calls: { method: string; path: string; body?: string }[] = []
  let status = 'pending'
  const routes: Partial<Record<string, () => unknown>> = {
    'GET /auth/me': () => ({ workspace_id: 'ws_1' }),
    'GET /api/lxc/topup-options': () => ({ usd_per_lxc: 0.1, min_usd_cents: 1000 }),
    'GET /api/agents': () => ({
      workspace_balance_ulxc: 0,
      allocated_ulxc: 0,
      unallocated_ulxc: 0,
      spent_ulxc: 0,
      agents: [{ id: 'ag_research', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }],
    }),
    'GET /api/agents/approvals': () => ({ approvals: [{ ...check, status }] }),
    'GET /api/wallets/capabilities': () => ({
      capabilities: [{ capability: 'agent_card', name: 'agent_card', class: 'RED', real_money: false, label: 'sandbox' }],
    }),
    'POST /api/agents/approvals/apr_3ds/challenge': () => ({ challenge: 'ch_3ds' }),
    'POST /api/agents/approvals/apr_3ds/approve': () => ((status = 'used'), {}),
    'POST /api/agents/approvals/apr_3ds/deny': () => ((status = 'denied'), {}),
  }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: init.body as string | undefined })
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`]
    return new Response(JSON.stringify(route ? route() : { error: 'no' }), { status: route ? 200 : 404 })
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dk_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
  mockPhone.reasons = []
})

const sheet = () => within(screen.getByTestId('approval-sheet'))
const signed = { device_id: 'dk_1', challenge: 'ch_3ds', signature: 'signed:talyvor-device-v1:ch_3ds' }

test('the push opens the card check’s own screen, where the sheet shows the merchant, the amount and the card', async () => {
  mockBff()
  expect(approvalHref({ type: 'card_challenge', approval_id: 'apr_3ds' })).toEqual({ pathname: '/approvals/[id]', params: { id: 'apr_3ds' } })
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_3ds' })

  await waitFor(() => expect(sheet().getByText('Confirm a card payment')).toBeTruthy())
  expect(sheet().getByRole('image', { name: "Research's agent card" })).toBeTruthy()
  expect(sheet().getAllByText('Research’s card')).toHaveLength(2)
  expect(sheet().getByText('$120.00')).toBeTruthy()
  expect(sheet().getByText('Northwind Books')).toBeTruthy()
  expect(sheet().getByLabelText('Sandbox')).toBeTruthy()
  expect(sheet().getByLabelText('Why it’s asking: Northwind Books asked the card to check with you')).toBeTruthy()
  expect(sheet().getByLabelText('Paid from: Research’s card')).toBeTruthy()
  expect(sheet().getByLabelText('Expires: Today at 23:58')).toBeTruthy()
  expect(sheet().getByText('No answer by then declines it.')).toBeTruthy()
  expect(sheet().getByText('This approves this payment only. Approving or declining asks for Face ID.')).toBeTruthy()
  expect(sheet().getByRole('button', { name: 'Approve with Face ID' })).toBeTruthy()
  expect(sheet().getByRole('button', { name: 'Decline' })).toBeTruthy()
})

test('Approve with Face ID sends this phone’s signature over the challenge, and the result says the payment goes ahead', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_3ds' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Approve with Face ID' }))

  const result = within(await screen.findByTestId('approval-result'))
  expect(result.getByText('Approved')).toBeTruthy()
  expect(result.getByText('The card payment at Northwind Books goes ahead.')).toBeTruthy()
  expect(result.getByLabelText('Signed with: Face ID on this iPhone')).toBeTruthy()
  expect(result.getByLabelText('Paid from: Research’s card')).toBeTruthy()
  expect(mockPhone.reasons).toEqual(['Approve $120.00 (1,200 LXC) at Northwind Books on Research’s card'])
  expect(JSON.parse(calls.find((c) => c.path === '/api/agents/approvals/apr_3ds/approve')!.body!)).toEqual({ assertion: signed })
})

test('Decline is signed at once, with no reason to give, and a phone with no key is asked to turn it on', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_3ds' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Decline' }))

  const result = within(await screen.findByTestId('approval-result'))
  expect(result.getByText('Declined. The card payment at Northwind Books does not go through.')).toBeTruthy()
  expect(result.getByLabelText('Declined with: Face ID on this iPhone')).toBeTruthy()
  expect(mockPhone.reasons).toEqual(['Decline $120.00 (1,200 LXC) at Northwind Books on Research’s card'])
  expect(JSON.parse(calls.find((c) => c.path === '/api/agents/approvals/apr_3ds/deny')!.body!)).toEqual({ assertion: signed })

  // Lens refuses an unsigned answer either way, so without a key neither button is offered.
  mockBff()
  mockStore.delete('talyvor.device-key')
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_3ds' })
  expect(await screen.findByText('Turn on Approve with Face ID on this phone first.')).toBeTruthy()
  expect(sheet().queryByRole('button', { name: 'Approve with Face ID' })).toBeNull()
  expect(sheet().queryByRole('button', { name: 'Decline' })).toBeNull()
})
