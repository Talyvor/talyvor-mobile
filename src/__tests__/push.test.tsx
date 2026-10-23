/// <reference types="node" />
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

// B40.14 DONE: a test notification opens the approval card for its request, and approving signs it with the device key
// and marks it approved in a mocked Lens.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-widgets', () => ({ createWidget: () => ({ updateSnapshot: () => undefined }) }))
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_: string, b: Uint8Array) => Uint8Array.from(jest.requireActual('node:crypto').createHash('sha256').update(b).digest()).buffer,
  randomUUID: () => 'uuid-1',
}))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** The notification the person tapped, as Lens's B40.15 push carries it. */
const mockTap: { data: Record<string, string> | null } = { data: null }
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('../../__mocks__/expo-notifications'),
  requestPermissionsAsync: async () => ({ granted: true }),
  getDevicePushTokenAsync: async () => ({ type: 'ios', data: 'a1b2c3d4' }),
  useLastNotificationResponse: () =>
    mockTap.data && { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: { request: { content: { data: mockTap.data } } } },
}))

/** This phone's approval key, on (B40.13): it signs only when the biometric check passes. */
const mockKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_: string, message: string) => jest.requireActual('node:crypto').sign('sha256', Buffer.from(message), { key: mockKey.privateKey, dsaEncoding: 'der' }).toString('base64url'),
  deleteKey: async () => undefined,
}))

const signedBy = (challenge: string, signature: string) => verify('sha256', Buffer.from(`talyvor-device-v1:${challenge}`), { key: mockKey.publicKey, dsaEncoding: 'der' }, Buffer.from(signature, 'base64url'))

/** Lens behind the BFF: one request prepared for approval, one agent's held payment, and dev_1 as this phone's key. */
function mockLens() {
  const lens = { pushTokens: {} as Record<string, string>, approvedStatement: '', approvalApproved: false }
  const items = [
    { position: 1, payee_id: 'py_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 2500, reference: 'Oct', decision: 'needs_approval', reason: 'a new payee' },
    { position: 2, payee_id: 'py_2', payee_name: 'Bolt Couriers', currency: 'GBP', amount_minor: 900, reference: 'Run 4', decision: 'needs_approval', reason: 'above 5.00 GBP' },
  ]
  const request = () => ({ id: 'preq_1', status: lens.approvedStatement ? 'approved' : 'pending_approval', summary: 'Pay October suppliers', client: 'chat', totals: { GBP: 3400 }, items, created_at: '2026-10-24T08:00:00Z' })
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const body = init.body ? JSON.parse(init.body as string) : {}
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (route) {
      case 'POST /api/money/devices/dev_1/push-token':
        lens.pushTokens.dev_1 = body.push_token
        return json({ id: 'dev_1', platform: 'ios', name: 'iPhone', person: 'owner@acme.test', created_at: '2026-10-23T16:00:00Z' })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_1', name: 'Buyer', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [{ id: 'apr_1', agent_id: 'ag_1', amount_ulxc: 2_000_000, model: '', payee: { kind: 'listing', id: 'l_1', name: 'GPU hour' }, status: lens.approvalApproved ? 'approved' : 'pending', created_at: '2026-10-24T08:00:00Z' }] })
      case 'POST /api/agents/approvals/apr_1/challenge':
        return json({ challenge: 'ch_apr_1' })
      case 'POST /api/agents/approvals/apr_1/approve': {
        const a = body.assertion
        if (a?.device_id !== 'dev_1' || a.challenge !== 'ch_apr_1' || !signedBy(a.challenge, a.signature)) return json({ error: 'economy: a passkey assertion is required' }, 403)
        lens.approvalApproved = true
        return json({})
      }
      case 'GET /api/money/payees':
        return json({ payees: [{ id: 'py_1', name: 'Acme Hosting', country: 'GB', needs_confirmation: false, created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/money/payments':
        return json({ payments: [] })
      case 'GET /api/money/payment-requests/preq_1':
        return json(request())
      case 'POST /api/money/payment-requests/preq_1/approval': {
        const chosen = items.filter((it) => body.positions.includes(it.position))
        const statement = JSON.stringify({ request_id: 'preq_1', items: chosen.map(({ position, payee_id, currency, amount_minor, reference }) => ({ position, payee_id, currency, amount_minor, reference })), expires_at: '2099-01-01T00:00:00Z' })
        return json({ statement, challenge: createHash('sha256').update(statement).digest('base64url') })
      }
      case 'POST /api/money/payment-requests/preq_1/approve': {
        // Lens's ApprovePaymentRequest: the device key's signature over the statement's SHA-256.
        const challenge = createHash('sha256').update(body.statement).digest('base64url')
        if (body.assertion?.device_id !== 'dev_1' || !signedBy(challenge, body.assertion.signature)) return json({ error: 'passkey: the assertion is not valid' }, 400)
        lens.approvedStatement = body.statement
        return json(request())
      }
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return lens
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dev_1')
  mockTap.data = null
})

test('a request notification opens its approval card; approving the ticked payment signs it with the device key and Lens approves it', async () => {
  const lens = mockLens()
  mockTap.data = { type: 'payment_request', request_id: 'preq_1', workspace_id: 'ws_1', url: 'talyvor://approve/preq_1' }
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Pay October suppliers')).toBeTruthy()
  expect(screen.getByText('Preview — test money only')).toBeTruthy()
  expect(screen.getByText('New payee · Verified')).toBeTruthy()
  expect(lens.pushTokens).toEqual({ dev_1: 'a1b2c3d4' })

  // Untick Bolt Couriers: the key signs a statement naming Acme Hosting alone.
  await fireEvent.press(screen.getByLabelText('Approve 9.00 GBP to Bolt Couriers'))
  await fireEvent.press(await screen.findByText('Approve 1 payment with Face ID'))
  expect(await screen.findByText('Approved. Each payment you approved is paid once.')).toBeTruthy()
  expect(JSON.parse(lens.approvedStatement).items.map((it: { position: number }) => it.position)).toEqual([1])
})

test('a held-payment notification opens its card, and Approve signs its challenge with the device key', async () => {
  const lens = mockLens()
  mockTap.data = { type: 'agent_approval', approval_id: 'apr_1', workspace_id: 'ws_1', agent_id: 'ag_1' }
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Buyer is waiting for you')).toBeTruthy()
  await fireEvent.press(screen.getAllByText('Approve').at(-1)!)
  expect(await screen.findByText('Approved. Nothing is waiting for you here.')).toBeTruthy()
  expect(lens.approvalApproved).toBe(true)
})

test('talyvor://approve/<id> opens the same card', async () => {
  mockLens()
  await renderRouter('./src/app', { initialUrl: '/approve/preq_1' })
  expect(await screen.findByText('Pay October suppliers')).toBeTruthy()
})
