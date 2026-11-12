/// <reference types="node" />
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import { Alert } from 'react-native'

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
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_: string, b: Uint8Array) => Uint8Array.from(jest.requireActual('node:crypto').createHash('sha256').update(b).digest()).buffer,
  randomUUID: () => 'uuid-1',
}))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** The notification the person tapped, as Lens's B40.15 push carries it, and the button they tapped on it. */
const mockTap: { data: Record<string, string> | null; action: string } = { data: null, action: 'expo.modules.notifications.actions.DEFAULT' }
const mockCategories: Record<string, { identifier: string; buttonTitle: string }[]> = {}
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('../../__mocks__/expo-notifications'),
  requestPermissionsAsync: async () => ({ granted: true }),
  getDevicePushTokenAsync: async () => ({ type: 'ios', data: 'a1b2c3d4' }),
  setNotificationCategoryAsync: async (id: string, actions: { identifier: string; buttonTitle: string }[]) => void (mockCategories[id] = actions),
  useLastNotificationResponse: () => mockTap.data && mockTapResponse,
}))
let mockTapResponse: unknown

/** This phone's approval key, on (B40.13): it signs only when the biometric check passes, whose prompt says `reason`. */
const mockReasons: string[] = []
const mockKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_: string, message: string, reason: string) => mockReasons.push(reason) && jest.requireActual('node:crypto').sign('sha256', Buffer.from(message), { key: mockKey.privateKey, dsaEncoding: 'der' }).toString('base64url'),
  deleteKey: async () => undefined,
}))

const signedBy = (challenge: string, signature: string) => verify('sha256', Buffer.from(`talyvor-device-v1:${challenge}`), { key: mockKey.publicKey, dsaEncoding: 'der' }, Buffer.from(signature, 'base64url'))

/** Lens behind the BFF: one request prepared for approval, one agent's held payment, and dev_1 as this phone's key. */
function mockLens() {
  const lens = { pushTokens: {} as Record<string, string>, approvedStatement: '', approvalApproved: false }
  const items: { position: number; payee_id: string; payee_name: string; currency: string; amount_minor: number; reference: string; decision: string; reason: string; pay_status?: string }[] = [
    { position: 1, payee_id: 'py_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 2500, reference: 'Oct', decision: 'needs_approval', reason: 'a new payee' },
    { position: 2, payee_id: 'py_2', payee_name: 'Bolt Couriers', currency: 'GBP', amount_minor: 900, reference: 'Run 4', decision: 'needs_approval', reason: 'above 5.00 GBP' },
  ]
  const request = () => ({ id: 'preq_1', status: lens.approvedStatement ? 'approved' : 'pending_approval', summary: 'Pay October suppliers', client: 'chat', totals: { GBP: 3400 }, items, created_at: '2026-10-24T08:00:00Z' })
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const body = init.body ? JSON.parse(init.body as string) : {}
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (route) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'POST /api/money/devices/dev_1/push-token':
        lens.pushTokens.dev_1 = body.push_token
        return json({ id: 'dev_1', platform: 'ios', name: 'iPhone', person: 'owner@acme.test', created_at: '2026-10-23T16:00:00Z' })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_1', name: 'Buyer', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [{ id: 'apr_1', agent_id: 'ag_1', amount_ulxc: 2_000_000, model: '', payee: { kind: 'listing', id: 'l_1', name: 'GPU hour' }, status: lens.approvalApproved ? 'approved' : 'pending', created_at: '2026-10-24T08:00:00Z' }] })
      case 'GET /api/lxc/topup-options':
        return json({ usd_per_lxc: 0.1, min_usd_cents: 1000 })
      case 'POST /api/agents/approvals/apr_1/challenge':
        return json({ challenge: 'ch_apr_1' })
      case 'POST /api/agents/approvals/apr_1/approve': {
        const a = body.assertion
        if (a?.device_id !== 'dev_1' || a.challenge !== 'ch_apr_1' || !signedBy(a.challenge, a.signature)) return json({ error: 'economy: a passkey assertion is required' }, 403)
        lens.approvalApproved = true
        return json({})
      }
      case 'GET /api/agents/keys/enrolments':
        return json({ enrolments: [{ id: 'enr_1', kind: 'passkey', name: 'Chrome on Mac', code: '042917', status: 'waiting', created_at: '2026-10-24T08:00:00Z', expires_at: '2026-10-24T08:10:00Z' }] })
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
        // What Lens did with each: the signed ones paid, the rest left out.
        const signed = (JSON.parse(body.statement).items as { position: number }[]).map((it) => it.position)
        for (const it of items) it.pay_status = signed.includes(it.position) ? 'completed' : 'not_approved'
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
  mockStore.set('talyvor.device-workspace', 'ws_1')
  mockTap.data = null
  mockTap.action = 'expo.modules.notifications.actions.DEFAULT'
})

/** Taps `action` on a notification with `data`; the same response object on every render, as expo-notifications keeps it. */
function tap(data: Record<string, string>, action = 'expo.modules.notifications.actions.DEFAULT') {
  mockTap.data = data
  mockTapResponse = { actionIdentifier: action, notification: { request: { content: { data } } } }
}

test('a request notification opens its approval card; approving the ticked payment signs it with the device key and Lens approves it', async () => {
  const lens = mockLens()
  tap({ type: 'payment_request', request_id: 'preq_1', workspace_id: 'ws_1', url: 'talyvor://approve/preq_1' })
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Pay October suppliers')).toBeTruthy()
  expect(screen.queryByText(/test money|preview/i)).toBeNull()
  expect(screen.getByText('Known payee · Verified · First payment · Reference: Oct')).toBeTruthy()
  expect(lens.pushTokens).toEqual({ dev_1: 'a1b2c3d4' })

  // Untick Bolt Couriers: the key signs a statement naming Acme Hosting alone.
  await fireEvent.press(screen.getByLabelText('Approve £9.00 to Bolt Couriers'))
  await fireEvent.press(await screen.findByText('Approve 1 payment with Face ID'))
  expect(await screen.findByText('Approved. Each payment you approved is paid once.')).toBeTruthy()
  expect(JSON.parse(lens.approvedStatement).items.map((it: { position: number }) => it.position)).toEqual([1])
})

test('a held-payment notification opens its approval sheet, and Approve with Face ID signs its challenge with the device key', async () => {
  const lens = mockLens()
  tap({ type: 'agent_approval', approval_id: 'apr_1', workspace_id: 'ws_1', agent_id: 'ag_1' })
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Buyer is waiting for you')).toBeTruthy()
  await fireEvent.press(await screen.findByRole('button', { name: 'Approve with Face ID' }))
  expect(await screen.findByTestId('approval-result')).toBeTruthy()
  expect(await screen.findByText(/^Approved (\d{1,2} [A-Z][a-z]{2}|today at \d\d:\d\d)\. Nothing is waiting for you here\.$/)).toBeTruthy()
  expect(lens.approvalApproved).toBe(true)
})

// B50.10: a money approval on the phone is made only through the biometric step; without this phone's key, Approve asks
// for it to be turned on and sends nothing.
test('without this phone\'s key, a held payment\'s sheet offers no approve, sends nothing and asks for the key first', async () => {
  const lens = mockLens()
  mockStore.delete('talyvor.device-key')
  tap({ type: 'agent_approval', approval_id: 'apr_1', workspace_id: 'ws_1', agent_id: 'ag_1' })
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Buyer is waiting for you')).toBeTruthy()
  expect(await screen.findByText('Turn on Approve with Face ID on this phone first.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve with Face ID' })).toBeNull()
  const sent = (globalThis.fetch as jest.Mock).mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
  expect(sent.filter((r: string) => /\/approvals\/apr_1\/(approve|challenge)/.test(r))).toEqual([])
  expect(lens.approvalApproved).toBeFalsy()
})

// B55.4: Lens (B55.1) pushes the workspace's phones when a key asks to join it; tapping it opens Approvals, where the
// browser waits with its code.
test('a key_enrolment notification opens Approvals, where the waiting browser shows with its code', async () => {
  mockLens()
  tap({ type: 'key_enrolment', enrolment_id: 'enr_1', workspace_id: 'ws_1' })
  await renderRouter('./src/app', { initialUrl: '/statement' })

  expect(await screen.findByText('A browser asks to approve payments too. Let it in only if you are adding it now and its code is 042917.')).toBeTruthy()
  expect(screen.getByText('Let it approve')).toBeTruthy()
})

// B57.74: after Face ID, a line for each payment says what happened to it.
test('approving on the card signs exactly the ticked payment, and a line for each says what happened', async () => {
  const lens = mockLens()
  await renderRouter('./src/app', { initialUrl: '/approve/preq_1' })
  await fireEvent.press(await screen.findByLabelText('Approve £9.00 to Bolt Couriers'))
  await fireEvent.press(await screen.findByText('Approve 1 payment with Face ID'))
  expect(await screen.findByText('Approved. Each payment you approved is paid once.')).toBeTruthy()
  expect(screen.getByText('Acme Hosting, £25.00: Paid.')).toBeTruthy()
  expect(screen.getByText('Bolt Couriers, £9.00: Not paid: you left it out.')).toBeTruthy()
  expect(JSON.parse(lens.approvedStatement).items).toEqual([{ position: 1, payee_id: 'py_1', currency: 'GBP', amount_minor: 2500, reference: 'Oct' }])
  expect(mockReasons.at(-1)).toBe('Approve 1 payment, £25.00: Acme Hosting £25.00')
})

test('talyvor://approve/<id> opens the same card', async () => {
  mockLens()
  await renderRouter('./src/app', { initialUrl: '/approve/preq_1' })
  expect(await screen.findByText('Pay October suppliers')).toBeTruthy()
})

// B41.34 DONE: a batch approved from the notification with Face ID is decided in Lens with the device key's signature
// over the batch hash.
const shownItems = [
  { position: 1, payee_id: 'py_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 2500, reference: 'Oct' },
  { position: 2, payee_id: 'py_2', payee_name: 'Bolt Couriers', currency: 'GBP', amount_minor: 900, reference: 'Run 4' },
]

test("Approve with Face ID on a request's notification signs the hash of exactly the items it names, and Lens approves them", async () => {
  const lens = mockLens()
  tap({ type: 'payment_request', request_id: 'preq_1', workspace_id: 'ws_1', items: JSON.stringify(shownItems) }, 'approve')
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Approved. Each payment you approved is paid once.')).toBeTruthy()
  // mockLens approves only a device-key signature over the statement's SHA-256, the batch hash.
  expect(JSON.parse(lens.approvedStatement).items).toEqual(shownItems.map(({ payee_name: _, ...it }) => it))
  expect(mockReasons.at(-1)).toBe('Approve 2 payments, £34.00: Acme Hosting £25.00, Bolt Couriers £9.00')
  expect(mockCategories.payment_request).toEqual([expect.objectContaining({ identifier: 'approve', buttonTitle: 'Approve with Face ID' })])
})

test('on an iPhone, where the data Lens sends is the top of the APNs payload, Approve with Face ID still approves exactly those items', async () => {
  const lens = mockLens()
  // Lens's APNs payload (nativepush.APNs.Send): aps with the category, then each data key beside it. expo-notifications
  // leaves content.data empty for it, since the payload has no `body` key.
  const payload = { aps: { alert: { title: 'Approval needed', body: 'Pay Acme Hosting, Bolt Couriers · £34.00' }, sound: 'default', category: 'payment_request' },
    type: 'payment_request', request_id: 'preq_1', workspace_id: 'ws_1', url: 'talyvor://approve/preq_1', items: JSON.stringify(shownItems) }
  mockTap.data = {}
  mockTapResponse = { actionIdentifier: 'approve', notification: { request: { content: { data: {}, categoryIdentifier: 'payment_request' }, trigger: { type: 'push', payload } } } }
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Approved. Each payment you approved is paid once.')).toBeTruthy()
  expect(JSON.parse(lens.approvedStatement).items).toEqual(shownItems.map(({ payee_name: _, ...it }) => it))
})

test('a notification whose items are not what Lens would have signed approves nothing', async () => {
  const lens = mockLens()
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  tap({ type: 'payment_request', request_id: 'preq_1', workspace_id: 'ws_1', items: JSON.stringify([{ ...shownItems[0], amount_minor: 25 }]) }, 'approve')
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Pay October suppliers')).toBeTruthy()
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Nothing was approved', 'what you were asked to sign is not what was shown, so nothing was signed'))
  expect(lens.approvedStatement).toBe('')
})

// B55.47 DONE: an agent's approval is approved from its notification with Face ID, as a prepared payment is. Lens's push
// (B55.12) names the agent, the payee and the amount in µLXC; the phone signs only the approval that matches them.
const agentPush = { type: 'agent_approval', approval_id: 'apr_1', workspace_id: 'ws_1', agent_id: 'ag_1', agent_name: 'Buyer', payee_name: 'GPU hour', currency: 'LXC', amount_minor: '2000000' }

test("Approve with Face ID on an agent's approval signs exactly that approval's challenge, and Lens approves it", async () => {
  const lens = mockLens()
  tap(agentPush, 'approve')
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText(/^Approved (\d{1,2} [A-Z][a-z]{2}|today at \d\d:\d\d)\. Nothing is waiting for you here\.$/)).toBeTruthy()
  expect(lens.approvalApproved).toBe(true)
  expect(mockReasons.at(-1)).toBe('Approve $0.20 (2 LXC) for Buyer')
  expect(mockCategories.agent_approval).toEqual([expect.objectContaining({ identifier: 'approve', buttonTitle: 'Approve with Face ID' })])
})

test.each([
  ['amount', { amount_minor: '200' }],
  ['payee', { payee_name: 'Someone else' }],
  ['agent', { agent_id: 'ag_2' }],
])("an agent's approval whose push names a different %s approves nothing", async (_, changed) => {
  const lens = mockLens()
  // The spy outlives a test, so it is cleared: a refusal another test caused must not count here.
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined).mockClear()
  tap({ ...agentPush, ...changed }, 'approve')
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  expect(await screen.findByText('Buyer is waiting for you')).toBeTruthy()
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Nothing was approved', 'what you were asked to sign is not what was shown, so nothing was signed'))
  const sent = (globalThis.fetch as jest.Mock).mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
  expect(sent.filter((r: string) => /\/approvals\/apr_1\/(approve|challenge)/.test(r))).toEqual([])
  expect(lens.approvalApproved).toBeFalsy()
})
