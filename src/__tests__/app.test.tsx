import { labelOf } from '@talyvor/bff-client'
import { render } from '@testing-library/react-native'
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import * as compose from '@expo/ui/jetpack-compose'
import * as Notifications from 'expo-notifications'
import * as modifiers from '@expo/ui/jetpack-compose/modifiers'
import { isValidElement, type ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

import { MoneyLabel } from '../components/money-label'
import { SessionProvider } from '../session'
import { AgentsWidgetAndroid } from '../widgets/agents-widget-android'

// B40.11 DONE: signs in against a mocked BFF, shows Home with the pending approval first, and pauses an agent.

// The first render loads the whole router and the widget modules, which takes CI's runner past jest's default 5 s.
jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'talyvor://auth',
  useAutoDiscovery: () => ({ authorizationEndpoint: 'https://idp/auth', tokenEndpoint: 'https://idp/token' }),
  useAuthRequest: () => [{ codeVerifier: 'verifier' }, null, async () => ({ type: 'success', params: { code: 'code-1' } })],
  exchangeCodeAsync: async () => ({ idToken: 'id-token-1' }),
}))
let mockUuid = 0
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockUuid}` }))
const mockSnapshots: { signedIn: boolean; agents: { id: string; paused: boolean; pauseUrl: string }[]; payees: { id: string; name: string; last: string; openUrl: string }[] }[] = []
jest.mock('expo-widgets', () => ({ ...jest.requireActual('../../__mocks__/expo-widgets'), createWidget: () => ({ updateSnapshot: (p: never) => mockSnapshots.push(p) }) }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** Face ID: `face` false is the person cancelling the check, so the key signs nothing. */
const mockPhone = { face: true, reasons: [] as string[], gone: false }
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_: string, message: string, reason: string) => {
    mockPhone.reasons.push(reason)
    if (mockPhone.gone) throw Object.assign(new Error('this phone has no approval key'), { code: 'ERR_TALYVOR_KEY' })
    if (!mockPhone.face) throw Object.assign(new Error('Face ID did not confirm, so nothing was signed'), { code: 'ERR_BIOMETRIC' })
    return `signed:${message}`
  },
  deleteKey: async () => undefined,
}))

/** The BFF as the app sees it: one workspace, two agents, one approval waiting. The workspace has a key, so Lens refuses
 * an unsigned resume. */
function mockBff(
  start: {
    paused?: boolean
    allPaused?: boolean
    approvals?: unknown[]
    requests?: { id: string }[]
    refuseSigned?: boolean
    sessionEnded?: boolean
    enrolments?: { id: string }[]
    labels?: 'live' | 'sandbox' | 'unread'
    usdPerLXC?: number
    areas?: string[]
  } = {},
) {
  const calls: { method: string; path: string; auth: string | undefined; body?: string; key?: string }[] = []
  let pausedAt = start.paused ? '2026-10-17T09:00:00Z' : undefined
  const agents = () => [
    { id: 'ag_1', name: 'Researcher', balance_ulxc: 12_500_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z', paused_at: pausedAt },
    { id: 'ag_2', name: 'Buyer', balance_ulxc: 3_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
  ]
  let enrolments = start.enrolments ?? []
  const routes: Partial<Record<string, (body?: string) => unknown>> = {
    // B55.4 — keys waiting to join (Lens B55.1): letting one in takes a phone key's signature over its own challenge.
    'GET /api/agents/keys/enrolments': () => ({ enrolments }),
    ...Object.fromEntries(enrolments.map((en) => [`POST /api/agents/keys/enrolments/${en.id}/challenge`, () => ({ challenge: `ch_${en.id}`, allow_credentials: [] })])),
    ...Object.fromEntries(enrolments.map((en) => [`POST /api/agents/keys/enrolments/${en.id}/approve`, (body?: string) => {
      if (JSON.parse(body ?? '{}').assertion?.challenge !== `ch_${en.id}`) return new Response(JSON.stringify({ error: 'economy: a passkey assertion is required' }), { status: 403 })
      enrolments = enrolments.filter((x) => x.id !== en.id)
      return { ...en, status: 'approved' }
    }])),
    ...Object.fromEntries(enrolments.map((en) => [`POST /api/agents/keys/enrolments/${en.id}/decline`, () => {
      enrolments = enrolments.filter((x) => x.id !== en.id)
      return { ...en, status: 'declined' }
    }])),
    'POST /auth/mobile/session': () => ({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }),
    'GET /auth/me': () => ({ workspace_id: 'ws_1' }),
    'GET /api/agents': () => ({
      workspace_balance_ulxc: 20_000_000,
      allocated_ulxc: 15_500_000,
      unallocated_ulxc: 4_500_000,
      spent_ulxc: 0,
      agents: agents(),
      all_paused_at: start.allPaused ? '2026-10-17T08:30:00Z' : undefined,
    }),
    'GET /api/agents/approvals': () => ({
      approvals: start.approvals ?? [{ id: 'apr_1', agent_id: 'ag_2', amount_ulxc: 2_000_000, model: '', payee: { kind: 'listing', id: 'l_1', name: 'GPU hour' }, status: 'pending', created_at: '2026-10-17T08:00:00Z' }],
    }),
    'GET /api/agents/ag_1/rules': () => ({ max_per_request_ulxc: 1_000_000, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 500_000, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'UTC' }),
    'POST /api/agents/ag_1/fund': () => ({ balance_ulxc: 15_000_000 }),
    'GET /api/money/payees': () => ({
      payees: [
        { id: 'py_1', name: 'Acme Hosting', country: 'GB', needs_confirmation: false, created_at: '2026-10-01T00:00:00Z' },
        { id: 'py_2', name: 'Kite Accounting', country: 'GB', needs_confirmation: false, created_at: '2026-10-02T00:00:00Z' },
      ],
    }),
    'GET /api/money/payments': () => ({
      payments: [{ id: 'pm_1', payee_id: 'py_1', payee_name: 'Acme Hosting', amount_minor: 2500, currency: 'GBP', reference: 'Sept', status: 'completed', created_at: '2026-10-03T10:00:00Z' }],
    }),
    'GET /api/money/accounts': () => ({ accounts: [{ id: 'acc_gbp', currency: 'GBP', purpose: 'company', status: 'open', name: 'The company · GBP', balance_minor: 100_000 }] }),
    'POST /api/money/payments/challenge': () => ({ challenge: 'ch_pay_1', allow_credentials: [] }),
    // B56.12: every money capability labelled as Lens answers it for this workspace; "unread" never answers.
    'GET /api/wallets/capabilities': () =>
      start.labels === 'unread'
        ? new Promise<never>(() => undefined)
        : {
            capabilities: ['spend_on_talyvor', 'move_between_own_agents', 'buy_marketplace_listings', 'payments_out', 'pay_another_owner'].map((capability) => ({
              capability,
              name: capability,
              class: 'GREEN',
              real_money: start.labels === 'live',
              label: start.labels,
            })),
          },
    'GET /api/agents/statement': () => ({
      from: '2026-11-01',
      to: '2026-12-01',
      accounts: [{ account: 'agent:ag_1', opening_ulxc: 0, in_ulxc: 12_500_000, out_ulxc: 0, closing_ulxc: 12_500_000 }],
      lines: [],
    }),
    // The workspace has a key, so Lens pays a person's payment only with a signature over its own challenge (B54.33).
    'POST /api/money/payments': (body) =>
      JSON.parse(body!).assertion
        ? { id: 'pm_2', payee_id: 'py_1', payee_name: 'Acme Hosting', amount_minor: 1250, currency: 'GBP', reference: 'October', status: 'pending', created_at: '2026-10-17T10:00:00Z' }
        : new Response(JSON.stringify({ error: 'economy: this workspace signs its payments with a passkey or the phone app' }), { status: 403 }),
    'GET /api/money/payment-requests?status=pending_approval': () => ({ requests: start.requests ?? [] }),
    ...Object.fromEntries((start.requests ?? []).map((r) => [`GET /api/money/payment-requests/${r.id}`, () => r])),
    ...Object.fromEntries((start.requests ?? []).map((r) => [`POST /api/money/payment-requests/${r.id}/cancel`, () => ({ ...r, status: 'cancelled' })])),
    // B59.3: the areas the operator switched on for this workspace (Lens B59.1); a default workspace has none.
    ...(start.areas ? { 'GET /api/workspace/areas': () => ({ areas: start.areas }) } : {}),
    ...(start.usdPerLXC ? { 'GET /api/lxc/topup-options': () => ({ usd_per_lxc: start.usdPerLXC, min_usd_cents: 1000 }) } : {}),
    'POST /api/agents/ag_1/pause': () => {
      pausedAt = '2026-10-17T09:00:00Z'
      return agents()[0]
    },
    'POST /api/agents/ag_1/resume-challenge': () => ({ challenge: 'ch_resume_1' }),
    'POST /api/agents/ag_1/resume': (body) => {
      if (!body) return new Response(JSON.stringify({ error: "economy: this workspace approves with a passkey — sign this approval's challenge" }), { status: 403 })
      if (start.refuseSigned) return new Response(JSON.stringify({ error: 'economy: device key revoked' }), { status: 403 })
      if (start.sessionEnded) return new Response(JSON.stringify({ error: 'unauthorised' }), { status: 401 })
      pausedAt = undefined
      return agents()[0]
    },
  }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '')
    const method = init.method ?? 'GET'
    const headers = init.headers as Record<string, string>
    const auth = headers.Authorization
    calls.push({ method, path, auth, body: init.body as string | undefined, key: headers['Idempotency-Key'] })
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`]
    const signedIn = path.startsWith('/auth/') || auth === 'Bearer session-1'
    const answer = route && signedIn ? route(init.body as string | undefined) : { error: 'no' }
    if (answer instanceof Response || answer instanceof Promise) return answer
    return new Response(JSON.stringify(answer), { status: route ? (signedIn ? 200 : 401) : 404 })
  }) as unknown as typeof fetch
  return calls
}

test('signs in, shows the pending approval first on Home, and pauses an agent', async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })

  await fireEvent.press(await screen.findByText('Sign in'))
  expect(await screen.findByText('1 waiting for you')).toBeTruthy()
  expect(calls.find((c) => c.path === '/auth/mobile/session')?.body).toBe(JSON.stringify({ id_token: 'id-token-1' }))
  expect(calls.filter((c) => c.path.startsWith('/api/')).every((c) => c.auth === 'Bearer session-1')).toBe(true)

  // Pending approval first: it comes before safe-to-spend and the agents.
  const order = ['Buyer wants to pay GPU hour', 'Safe to spend', 'Researcher']
  const texts = screen.getAllByText(/./).map((t) => [t.props.children].flat().join(''))
  const at = order.map((o) => texts.findIndex((t) => t.startsWith(o)))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(screen.getByText('18 LXC')).toBeTruthy() // 20 LXC less the 2 LXC waiting

  await fireEvent.press(screen.getByLabelText('Researcher, active'))
  expect(await screen.findByText('Spends at most 1 LXC on one request.')).toBeTruthy()
  expect(screen.getByText('Asks you first above 0.5 LXC.')).toBeTruthy()
  await fireEvent.press(screen.getByText('Pause'))
  await waitFor(() => expect(screen.getByText('Resume')).toBeTruthy())
  expect(calls.find((c) => c.method === 'POST' && c.path === '/api/agents/ag_1/pause')?.body).toBe(
    JSON.stringify({ reason: 'Paused from the phone app' }),
  )
})

const lastSnapshot = () => mockSnapshots[mockSnapshots.length - 1]

// The 'widget' directive compiles a layout to its source; Android's widget runtime evaluates it with these as globals.
const layoutScope = { ...compose, ...modifiers, _jsx: jsx, _jsxs: jsxs, _Fragment: Fragment }
const androidLayout = new Function(...Object.keys(layoutScope), `return (${AgentsWidgetAndroid})`)(
  ...Object.values(layoutScope),
) as typeof AgentsWidgetAndroid

// The Android layout drawn from what the app pushed: each Button's target is what a tap sends the widget's provider.
const draw = () => {
  const buttons: { label: string; target: string }[] = []
  const texts: string[] = []
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n === 'string') return void texts.push(n)
    if (!isValidElement<{ children?: ReactNode; target?: string }>(n)) return
    const before = texts.length
    walk(n.props.children)
    if (n.props.target) buttons.push({ label: texts.slice(before).join(''), target: n.props.target })
  }
  walk(androidLayout(lastSnapshot() as never, { colorScheme: 'dark', configuration: undefined }))
  return { buttons, texts }
}

describe('B55.8 expired approvals', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  })
  const day = (at: string) => new Date(at).toLocaleDateString()

  test('an expired approval reads Expired in the list and on its screen, and decided rows are dated when decided', async () => {
    mockBff({ approvals: [
      { id: 'apr_2', agent_id: 'ag_2', amount_ulxc: 2_000_000, model: '', status: 'expired', created_at: '2026-10-10T08:00:00Z' },
      { id: 'apr_3', agent_id: 'ag_2', amount_ulxc: 1_000_000, model: '', status: 'expired', created_at: '2026-10-11T08:00:00Z', decided_at: '2026-10-11T09:00:00Z' },
      { id: 'apr_4', agent_id: 'ag_1', amount_ulxc: 1_000_000, model: '', status: 'used', created_at: '2026-10-12T08:00:00Z', decided_at: '2026-10-14T08:00:00Z' },
    ] })
    await renderRouter('./src/app', { initialUrl: '/approvals' })
    expect(await screen.findByText(`Expired · ${day('2026-10-10T08:00:00Z')}`)).toBeTruthy()
    expect(screen.getByText(`Approved and spent · ${day('2026-10-14T08:00:00Z')}`)).toBeTruthy()

    await renderRouter('./src/app', { initialUrl: '/approvals/apr_2' })
    expect(await screen.findByText('Expired: nobody answered within 24 hours. Nothing is waiting for you here.')).toBeTruthy()
    expect(screen.getByText('Buyer’s request')).toBeTruthy()
    expect(screen.queryByText('Buyer is waiting for you')).toBeNull()

    await renderRouter('./src/app', { initialUrl: '/approvals/apr_3' })
    expect(await screen.findByText('Expired: approved, but not used within 24 hours. Nothing is waiting for you here.')).toBeTruthy()
  })
})

describe('B55.27 money dollars first', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  })

  test('Home writes dollars first beside LXC by the peg', async () => {
    mockBff({ usdPerLXC: 0.1 })
    await renderRouter('./src/app', { initialUrl: '/' })
    expect(await screen.findByLabelText('$1.80 (18 LXC)')).toBeTruthy() // 20 LXC less the 2 LXC waiting, at $0.10 an LXC
    expect(screen.getByLabelText('$1.25 (12.5 LXC)')).toBeTruthy()
    expect(screen.getByText('$0.20 (2 LXC)')).toBeTruthy()
  })

  test('Home writes LXC alone when the peg cannot be read', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    expect(await screen.findByText('18 LXC')).toBeTruthy()
    await waitFor(() => expect(calls.some((c) => c.path === '/api/lxc/topup-options')).toBe(true))
    expect(screen.queryByText(/\$/)).toBeNull()
  })
})

describe('B41.35 home-screen widget', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
    mockStore.set('talyvor.device-key', 'dk_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    mockSnapshots.length = 0
  })

  test("tapping Pause on an agent's widget pauses it in Lens and the widget then reads paused", async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    await waitFor(() => expect(lastSnapshot()?.agents.find((a) => a.id === 'ag_1')?.paused).toBe(false))
    const pauseUrl = lastSnapshot().agents.find((a) => a.id === 'ag_1')!.pauseUrl
    expect(pauseUrl).toMatch(/^talyvor:\/\/widget\?do=pause&agent=ag_1&t=uuid-\d+$/)

    // What iOS opens when the widget's Pause is tapped.
    await renderRouter('./src/app', { initialUrl: pauseUrl.replace('talyvor://', '/') })
    expect(await screen.findByText('Resume')).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/agents/ag_1/pause')?.body).toBe(
      JSON.stringify({ reason: 'Paused from the home-screen widget' }),
    )
    expect(lastSnapshot().agents.find((a) => a.id === 'ag_1')?.paused).toBe(true)
  })

  test("on Android, the widget's Pause opens the same token-checked link and the widget then reads Paused", async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    await waitFor(() => expect(lastSnapshot()?.agents.find((a) => a.id === 'ag_1')?.paused).toBe(false))
    const pause = draw().buttons.find((b) => b.label === 'Pause')!
    expect(pause.target).toBe(lastSnapshot().agents.find((a) => a.id === 'ag_1')!.pauseUrl)

    // TalyvorAgentsProvider opens a talyvor:// target as a link into the app.
    await renderRouter('./src/app', { initialUrl: pause.target.replace('talyvor://', '/') })
    expect(await screen.findByText('Resume')).toBeTruthy()
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/agents/ag_1/pause')).toHaveLength(1)
    const after = draw()
    expect(after.texts).toContain('Paused')
    expect(after.buttons.find((b) => b.label === 'Resume')?.target).toBe('talyvor://agents/ag_1')
  })

  test('a pause link that did not come from the widget changes nothing', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/widget?do=pause&agent=ag_1&t=forged' })
    expect(await screen.findByText('This link did not come from your Talyvor widget, so nothing changed.')).toBeTruthy()
    expect(calls.some((c) => c.path.endsWith('/pause'))).toBe(false)
  })

  test('pinning puts only that agent on the widget, and Fund sends whole µLXC with an idempotency key', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })
    await fireEvent.press(await screen.findByText('Pin to widget'))
    await waitFor(() => expect(lastSnapshot()?.agents.map((a) => a.id)).toEqual(['ag_1']))

    await fireEvent.changeText(screen.getByLabelText('Amount in LXC'), '2.5')
    await fireEvent.press(screen.getByRole('button', { name: 'Fund' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/agents/ag_1/fund')).toBe(true))
    const fund = calls.find((c) => c.path === '/api/agents/ag_1/fund')!
    expect(fund.body).toBe(JSON.stringify({ amount_ulxc: 2_500_000 }))
    expect(fund.key).toMatch(/^uuid-\d+$/)
  })

  test('B41.203: a pinned payee shows on the widget, its tap opens the payment screen, and only that screen pays', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/payees/py_1' })
    await fireEvent.press(await screen.findByRole('switch', { name: 'Pinned to your home-screen widget' }))
    await waitFor(() => expect(lastSnapshot()?.payees).toEqual([{ id: 'py_1', name: 'Acme Hosting', last: '£25.00 on 3 Oct', openUrl: 'talyvor://payees/py_1' }]))
    const pay = draw().buttons.find((b) => b.label === 'Pay')!
    expect(pay.target).toBe('talyvor://payees/py_1')

    // The widget's tap opens the payment screen for that payee and pays nothing.
    await renderRouter('./src/app', { initialUrl: pay.target.replace('talyvor://', '/') })
    expect(await screen.findByText('Acme Hosting')).toBeTruthy()
    expect(screen.queryByText(/test money|preview/i)).toBeNull()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/money/payments')).toBe(false)

    await fireEvent.changeText(screen.getByLabelText('Amount in GBP'), '12.5')
    await fireEvent.changeText(screen.getByLabelText('Reference'), 'October')
    await fireEvent.press(screen.getByRole('button', { name: 'Pay £12.50' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('£12.50 to Acme Hosting is on its way.')).toBeTruthy()
    const sent = calls.filter((c) => c.method === 'POST' && c.path === '/api/money/payments')
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0].body!)).toEqual({
      account_id: 'acc_gbp',
      payee_id: 'py_1',
      amount_minor: 1250,
      currency: 'GBP',
      reference: 'October',
      idempotency_key: expect.stringMatching(/^uuid-\d+$/),
      assertion: { device_id: 'dk_1', challenge: 'ch_pay_1', signature: 'signed:talyvor-device-v1:ch_pay_1' },
    })
  })

})

describe('B55.5 Resume signed with Face ID', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
    mockPhone.face = true
    mockPhone.reasons = []
  })
  const resumes = (calls: ReturnType<typeof mockBff>) => calls.filter((c) => c.method === 'POST' && c.path.startsWith('/api/agents/ag_1/resume'))

  test("with the phone's key on, Resume asks first, then signs the resume challenge and sends the assertion", async () => {
    mockStore.set('talyvor.device-key', 'dev_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    const calls = mockBff({ paused: true })
    await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })

    await fireEvent.press(await screen.findByText('Resume'))
    expect(screen.getByText('Resume Researcher?')).toBeTruthy()
    expect(screen.getByText('Its requests and payments are served again, within its rules.')).toBeTruthy()
    expect(resumes(calls)).toEqual([])
    await fireEvent.press(screen.getByText('Resume with Face ID'))

    expect(await screen.findByText('Active.')).toBeTruthy()
    expect(resumes(calls).map((c) => c.path)).toEqual(['/api/agents/ag_1/resume-challenge', '/api/agents/ag_1/resume'])
    expect(JSON.parse(resumes(calls)[1].body!)).toEqual({ assertion: { device_id: 'dev_1', challenge: 'ch_resume_1', signature: 'signed:talyvor-device-v1:ch_resume_1' } })
    expect(mockPhone.reasons).toEqual(['Resume Researcher'])
  })

  test('Not now, and a cancelled Face ID, send no resume', async () => {
    mockStore.set('talyvor.device-key', 'dev_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    mockPhone.face = false
    const calls = mockBff({ paused: true })
    await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })

    await fireEvent.press(await screen.findByText('Resume'))
    await fireEvent.press(screen.getByText('Not now'))
    expect(screen.queryByText('Resume Researcher?')).toBeNull()
    await fireEvent.press(screen.getByText('Resume'))
    await fireEvent.press(screen.getByText('Resume with Face ID'))

    expect(await screen.findByText('Nothing changed. You can try again.')).toBeTruthy()
    expect(resumes(calls).map((c) => c.path)).toEqual(['/api/agents/ag_1/resume-challenge'])
  })

  test("a signed resume Lens refuses shows words, never Lens's own sentence", async () => {
    mockStore.set('talyvor.device-key', 'dev_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    mockBff({ paused: true, refuseSigned: true })
    await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })

    await fireEvent.press(await screen.findByText('Resume'))
    await fireEvent.press(screen.getByText('Resume with Face ID'))
    expect(await screen.findByText('Nothing changed. You can try again.')).toBeTruthy()
    expect(screen.queryByText('Device key revoked.')).toBeNull()
  })

  test('a resume after the session ended says to sign in again, then try again', async () => {
    mockStore.set('talyvor.device-key', 'dev_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    mockBff({ paused: true, sessionEnded: true })
    await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })

    await fireEvent.press(await screen.findByText('Resume'))
    await fireEvent.press(screen.getByText('Resume with Face ID'))
    expect(await screen.findByText('Nothing changed. Sign in again, then try again.')).toBeTruthy()
  })

  test("with the phone's key off, a resume Lens refuses unsigned says where to do it", async () => {
    const calls = mockBff({ paused: true })
    await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })

    await fireEvent.press(await screen.findByText('Resume'))
    expect(screen.queryByText('Resume Researcher?')).toBeNull()

    expect(await screen.findByText('Resume Researcher on the web with your passkey, or turn on Approve with Face ID on this phone.')).toBeTruthy()
    expect(resumes(calls).map((c) => [c.path, c.body])).toEqual([['/api/agents/ag_1/resume', undefined]])
  })

  test("with the phone's key made in another workspace, a resume is sent unsigned and says where to do it", async () => {
    mockStore.set('talyvor.device-key', 'dev_1')
    mockStore.set('talyvor.device-workspace', 'ws_other')
    const calls = mockBff({ paused: true })
    await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })

    await fireEvent.press(await screen.findByText('Resume'))
    expect(await screen.findByText('Resume Researcher on the web with your passkey, or turn on Approve with Face ID on this phone.')).toBeTruthy()
    expect(resumes(calls).map((c) => [c.path, c.body])).toEqual([['/api/agents/ag_1/resume', undefined]])
    expect(mockPhone.reasons).toEqual([])
  })

  test('while every agent is paused, resuming one says it waits for every agent to start again', async () => {
    mockStore.set('talyvor.device-key', 'dev_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    mockBff({ paused: true, allPaused: true })
    await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })

    await fireEvent.press(await screen.findByText('Resume'))
    await fireEvent.press(screen.getByText('Resume with Face ID'))
    expect(await screen.findByText('Researcher runs when you start every agent again. Until then it stays paused with every agent.')).toBeTruthy()
  })
})

describe('B55.25 a payment from the phone confirms with Face ID', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
    mockStore.set('talyvor.device-key', 'dk_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    mockPhone.face = true
    mockPhone.reasons = []
    mockPhone.gone = false
  })
  const posted = (calls: ReturnType<typeof mockBff>) => calls.filter((c) => c.method === 'POST' && c.path === '/api/money/payments')
  const challenged = (calls: ReturnType<typeof mockBff>) => calls.filter((c) => c.method === 'POST' && c.path === '/api/money/payments/challenge')

  async function typePayment(payee: string) {
    await renderRouter('./src/app', { initialUrl: `/payees/${payee}` })
    await fireEvent.changeText(await screen.findByLabelText('Amount in GBP'), '12.5')
    await fireEvent.changeText(screen.getByLabelText('Reference'), 'October')
    await fireEvent.press(screen.getByRole('button', { name: 'Pay £12.50' }))
  }

  test('Pay sends nothing; a cancelled check sends nothing; a passing check posts once with its idempotency key', async () => {
    const calls = mockBff()
    await typePayment('py_1')
    expect(await screen.findByText('Pay Acme Hosting £12.50?')).toBeTruthy()
    expect(screen.getAllByText('The company · GBP')).toHaveLength(2) // the From field and the confirm step
    expect(screen.getByText('October')).toBeTruthy()
    expect(posted(calls)).toHaveLength(0)

    mockPhone.face = false
    await fireEvent.press(screen.getByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('Nothing was paid.')).toBeTruthy()
    expect(mockPhone.reasons).toEqual(['Pay Acme Hosting £12.50'])
    expect(posted(calls)).toHaveLength(0)

    mockPhone.face = true
    await fireEvent.press(screen.getByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('£12.50 to Acme Hosting is on its way.')).toBeTruthy()
    expect(posted(calls)).toHaveLength(1)
    expect(JSON.parse(posted(calls)[0].body!).idempotency_key).toMatch(/^uuid-\d+$/)
  })

  test('B54.36: the payment carries Face ID’s signature over the challenge Lens gave for that exact payment', async () => {
    const calls = mockBff()
    await typePayment('py_1')
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('£12.50 to Acme Hosting is on its way.')).toBeTruthy()
    expect(challenged(calls)).toHaveLength(1)
    const { assertion, ...payment } = JSON.parse(posted(calls)[0].body!)
    expect(JSON.parse(challenged(calls)[0].body!)).toEqual(payment)
    expect(payment).toMatchObject({ account_id: 'acc_gbp', payee_id: 'py_1', amount_minor: 1250, currency: 'GBP', reference: 'October' })
    expect(assertion).toEqual({ device_id: 'dk_1', challenge: 'ch_pay_1', signature: 'signed:talyvor-device-v1:ch_pay_1' })
  })

  test('B54.36: changing the From account changes the idempotency key; trying again unchanged keeps it', async () => {
    const calls = mockBff()
    globalThis.fetch = ((f) => async (url: string, init: RequestInit = {}) =>
      url.endsWith('/api/money/accounts')
        ? new Response(JSON.stringify({ accounts: [
            { id: 'acc_gbp', currency: 'GBP', purpose: 'company', status: 'open', name: 'The company · GBP', balance_minor: 100_000 },
            { id: 'acc_gbp_2', currency: 'GBP', purpose: 'company', status: 'open', name: 'Payroll · GBP', balance_minor: 50_000 },
          ] }))
        : f(url, init))(globalThis.fetch) as typeof fetch
    await typePayment('py_1')
    mockPhone.face = false
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('Nothing was paid.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Pay with Face ID' }))
    await waitFor(() => expect(challenged(calls)).toHaveLength(2))
    const asked = () => challenged(calls).map((c) => JSON.parse(c.body!))
    expect(asked()[1].idempotency_key).toBe(asked()[0].idempotency_key)

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
    await fireEvent.press(await screen.findByRole('button', { name: /^From The company · GBP/ }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Payroll · GBP, £500.00' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Pay £12.50' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    await waitFor(() => expect(challenged(calls)).toHaveLength(3))
    expect(asked()[2].account_id).toBe('acc_gbp_2')
    expect(asked()[2].idempotency_key).not.toBe(asked()[0].idempotency_key)
    expect(posted(calls)).toHaveLength(0)
  })

  test('B54.36: a key a new Face ID made unusable says how to turn approving on again, and sends nothing', async () => {
    const calls = mockBff()
    mockPhone.gone = true
    await typePayment('py_1')
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('Face ID changed on this phone, so its key no longer works. Turn approving on again in Approvals, then try again.')).toBeTruthy()
    expect(posted(calls)).toHaveLength(0)
    // The phone forgets the dead key, so Approvals offers Turn on again.
    await waitFor(() => expect(mockStore.has('talyvor.device-key')).toBe(false))
  })

  test('Cancel closes the confirm step and sends nothing', async () => {
    const calls = mockBff()
    await typePayment('py_1')
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Pay Acme Hosting £12.50?')).toBeNull())
    expect(mockPhone.reasons).toEqual([])
    expect(posted(calls)).toHaveLength(0)
  })

  test('B57.72: without this phone’s key the step offers Approvals on this phone in place of Pay with Face ID, and nothing is checked or sent', async () => {
    const calls = mockBff()
    mockStore.delete('talyvor.device-key')
    await typePayment('py_1')
    expect(await screen.findByText('Turn on Approve with Face ID on this phone first: Talyvor asks for Face ID before each payment from this phone.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pay with Face ID' })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Approvals on this phone' }))
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeTruthy()
    expect(mockPhone.reasons).toEqual([])
    expect(challenged(calls)).toHaveLength(0)
    expect(posted(calls)).toHaveLength(0)
  })

  test('a first payment needs both answers, and a Yes also the box', async () => {
    const calls = mockBff()
    await typePayment('py_2')
    expect(await screen.findByText('Pay Kite Accounting £12.50?')).toBeTruthy()
    const payWithFace = (disabled: boolean) => screen.getByRole('button', { name: 'Pay with Face ID', disabled })
    expect(payWithFace(true)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Were you told to pay urgently? No' }))
    expect(payWithFace(true)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Did the bank details arrive by email or chat? Yes' }))
    expect(await screen.findByText(/^Stop and check\. This could be a scam\./)).toBeTruthy()
    expect(screen.getByText(/call Kite Accounting on a number you already have/)).toBeTruthy()
    expect(payWithFace(true)).toBeTruthy()

    await fireEvent.press(screen.getByRole('checkbox', { name: 'I have checked the details with Kite Accounting directly and still want to pay.' }))
    await fireEvent.press(payWithFace(false))
    await waitFor(() => expect(posted(calls)).toHaveLength(1))
    expect(JSON.parse(posted(calls)[0].body!).payee_id).toBe('py_2')
  })

  test('the result says Paid when Lens completes it, and not paid with its detail when it fails', async () => {
    mockBff()
    const pay = (status: string, detail?: string) =>
      (globalThis.fetch = ((f) => async (url: string, init: RequestInit = {}) =>
        init.method === 'POST' && url.endsWith('/api/money/payments')
          ? new Response(JSON.stringify({ id: 'pm_3', payee_id: 'py_1', payee_name: 'Acme Hosting', amount_minor: 1250, currency: 'GBP', reference: 'October', status, detail, created_at: '2026-10-17T10:00:00Z' }))
          : f(url, init))(globalThis.fetch) as typeof fetch)
    pay('completed')
    await typePayment('py_1')
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('Paid Acme Hosting £12.50.')).toBeTruthy()

    mockBff()
    pay('failed', 'the payee’s bank refused it')
    await typePayment('py_1')
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('£12.50 to Acme Hosting was not paid: the payee’s bank refused it.')).toBeTruthy()
  })
})

describe('B57.72 Pay and a payee', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
    mockStore.set('talyvor.device-key', 'dk_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    mockPhone.face = true
    mockPhone.reasons = []
    mockPhone.gone = false
  })
  const posted = (calls: ReturnType<typeof mockBff>) => calls.filter((c) => c.method === 'POST' && c.path === '/api/money/payments')
  const today = new Date().toISOString()
  const prepared = (status = 'pending_approval', pay_status?: string) => ({
    id: 'preq_k',
    status,
    summary: '',
    client: 'chat',
    totals: { GBP: 18_000 },
    items: [{ position: 1, payee_id: 'py_2', payee_name: 'Kite Accounting', currency: 'GBP', amount_minor: 18_000, reference: 'Invoice 1042', decision: 'needs_approval', reason: 'first payment to this payee', pay_status }],
    created_at: today,
  })
  /** The BFF with one route answered differently; every call is still recorded. */
  const answer = (route: (url: string, init: RequestInit) => Response | undefined) =>
    (globalThis.fetch = ((f) => async (url: string, init: RequestInit = {}) => {
      const recorded = await f(url, init)
      return route(url, init) ?? recorded
    })(globalThis.fetch) as typeof fetch)

  test('Pay lists the saved payees, each with its last payment and to its screen, and says where payees are added', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/pay' })
    expect(await screen.findByText('£25.00 on 3 Oct')).toBeTruthy()
    expect(screen.getByText('Not paid yet')).toBeTruthy()
    expect(screen.getByText('Payees are added in Talyvor on the web.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('link', { name: 'Pay Kite Accounting' }))
    expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.getByText('Kite Accounting')).toBeTruthy()
  })

  test('From is one field that opens the open accounts with their balances; Pay names the amount in the account’s currency', async () => {
    mockBff()
    answer((url) =>
      url.endsWith('/api/money/accounts')
        ? new Response(JSON.stringify({ accounts: [
            { id: 'acc_gbp', currency: 'GBP', purpose: 'company', status: 'open', name: 'The company · GBP', balance_minor: 100_000 },
            { id: 'acc_usd', currency: 'USD', purpose: 'company', status: 'open', name: 'The company · USD', balance_minor: 320_000 },
            { id: 'acc_old', currency: 'EUR', purpose: 'company', status: 'closed', name: 'Old · EUR', balance_minor: 0 },
          ] }))
        : undefined,
    )
    await renderRouter('./src/app', { initialUrl: '/payees/py_1' })
    expect(await screen.findByText('Last payment: £25.00 on 3 Oct')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^The company · USD/ })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'From The company · GBP, £1,000.00' }))
    expect(screen.getByRole('button', { name: 'The company · GBP, £1,000.00' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Old · EUR/ })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'The company · USD, $3,200.00' }))
    await fireEvent.changeText(await screen.findByLabelText('Amount in USD'), '450')
    expect(screen.getByRole('button', { name: 'Pay $450.00' })).toBeTruthy()
  })

  test('the confirm step carries the reference’s lines; after paying, the result says where it was sent from', async () => {
    const calls = mockBff()
    answer((url, init) =>
      init.method === 'POST' && url.endsWith('/api/money/payments')
        ? new Response(JSON.stringify({ id: 'pm_3', payee_id: 'py_2', payee_name: 'Kite Accounting', amount_minor: 45_000, currency: 'GBP', reference: 'November bookkeeping', status: 'completed', created_at: today }))
        : undefined,
    )
    await renderRouter('./src/app', { initialUrl: '/payees/py_2' })
    expect(await screen.findByText('Not paid yet')).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText('Amount in GBP'), '450')
    await fireEvent.changeText(screen.getByLabelText('Reference'), 'November bookkeeping')
    await fireEvent.press(screen.getByRole('button', { name: 'Pay £450.00' }))
    expect(await screen.findByText('Pay Kite Accounting £450.00?')).toBeTruthy()
    expect(screen.getByText('This is your first payment to Kite Accounting, so Talyvor asks two questions first.')).toBeTruthy()
    expect(screen.getByText('Face ID asks before anything is sent. A cancelled Face ID pays nothing.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Were you told to pay urgently? No' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Did the bank details arrive by email or chat? No' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('Paid Kite Accounting £450.00.')).toBeTruthy()
    expect(screen.getByText('Sent today from the company’s account.')).toBeTruthy()
    expect(posted(calls)).toHaveLength(1)
  })

  test('a retry after a dropped answer sends the same idempotency key, so Lens pays once', async () => {
    const calls = mockBff()
    let drop = true
    answer((url, init) => {
      if (init.method !== 'POST' || !url.endsWith('/api/money/payments') || !drop) return undefined
      drop = false
      return new Response(JSON.stringify({ error: 'the payments service did not answer' }), { status: 503 })
    })
    await renderRouter('./src/app', { initialUrl: '/payees/py_1' })
    await fireEvent.changeText(await screen.findByLabelText('Amount in GBP'), '12.5')
    await fireEvent.press(screen.getByRole('button', { name: 'Pay £12.50' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    await waitFor(() => expect(posted(calls)).toHaveLength(1))
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay with Face ID' }))
    expect(await screen.findByText('£12.50 to Acme Hosting is on its way.')).toBeTruthy()
    const keys = posted(calls).map((c) => JSON.parse(c.body!).idempotency_key)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  test('a payment prepared for the payee and still waiting offers Review it in place of Pay; once approved, the payee says it is paid', async () => {
    let request = prepared()
    const calls = mockBff({ requests: [request] })
    answer((url) => {
      if (url.endsWith('/api/money/payment-requests?status=pending_approval'))
        return new Response(JSON.stringify({ requests: request.status === 'pending_approval' ? [request] : [] }))
      if (url.endsWith('/api/money/payment-requests/preq_k')) return new Response(JSON.stringify(request))
      return undefined
    })
    await renderRouter('./src/app', { initialUrl: '/payees/py_2' })
    expect(await screen.findByText('Chat prepared this payment, and it waits for you.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull()
    await fireEvent.press(screen.getByRole('link', { name: 'Review it' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/money/payment-requests/preq_k')).toBe(true))

    request = prepared('approved', 'completed')
    await renderRouter('./src/app', { initialUrl: '/payees/py_2' })
    expect(await screen.findByText('Paid Kite Accounting £180.00.')).toBeTruthy()
    expect(screen.getByText('The payment Chat prepared, approved by you today.')).toBeTruthy()
    expect(screen.queryByText('Chat prepared this payment, and it waits for you.')).toBeNull()
    await fireEvent.changeText(screen.getByLabelText('Amount in GBP'), '180')
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull()
    expect(posted(calls)).toHaveLength(0)
  })
})

describe('B55.11 prepared payments on Home and Approvals', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  })
  const item = (over: object = {}) => ({ position: 1, payee_id: 'py_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 4200, reference: 'November hosting', decision: 'needs_approval', reason: 'above the approval amount', rule: 'R-APPROVE-1', ...over })
  const preq = (over: object = {}) => ({ id: 'preq_1', status: 'pending_approval', summary: '', client: 'mcp:claude-desktop', totals: { GBP: 4200 }, items: [item()], created_at: '2026-11-09T08:00:00Z', ...over })
  const allText = () => screen.getAllByText(/./).map((t) => [t.props.children].flat().join('')).join('\n')

  test('Home and Approvals list a prepared payment above the agents’ requests, and it opens its approval card', async () => {
    const calls = mockBff({ requests: [preq()] })
    await renderRouter('./src/app', { initialUrl: '/' })
    expect(await screen.findByText('Your assistant prepared a payment to Acme Hosting')).toBeTruthy()
    expect(screen.getByText('2 waiting for you')).toBeTruthy()
    const texts = screen.getAllByText(/./).map((t) => [t.props.children].flat().join(''))
    expect(texts.findIndex((t) => t.startsWith('Your assistant prepared'))).toBeLessThan(texts.findIndex((t) => t.startsWith('Buyer wants to pay')))
    expect(screen.getByText('£42.00')).toBeTruthy()

    await renderRouter('./src/app', { initialUrl: '/approvals' })
    await fireEvent.press(await screen.findByText('Your assistant prepared a payment to Acme Hosting'))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/money/payment-requests/preq_1')).toBe(true))
    expect(await screen.findByRole('button', { name: 'Decline' })).toBeTruthy()
  })

  test('Decline asks first, Keep it sends nothing, and Decline posts /cancel once and says so', async () => {
    const calls = mockBff({ requests: [preq()] })
    const cancels = () => calls.filter((c) => c.method === 'POST' && c.path === '/api/money/payment-requests/preq_1/cancel')
    await renderRouter('./src/app', { initialUrl: '/approve/preq_1' })
    await fireEvent.press(await screen.findByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Decline these payments? Nothing waiting here is paid.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByText('Decline these payments? Nothing waiting here is paid.')).toBeNull()
    expect(cancels()).toHaveLength(0)

    await fireEvent.press(screen.getByRole('button', { name: 'Decline' }))
    const confirm = await screen.findAllByRole('button', { name: 'Decline' })
    await fireEvent.press(confirm[confirm.length - 1])
    expect(await screen.findByText('Declined. Nothing waiting here will be paid.')).toBeTruthy()
    expect(cancels()).toHaveLength(1)
  })

  test('each item says where it stands in words, with no rule code and no mandate', async () => {
    mockBff({
      requests: [
        preq({
          status: 'approved',
          items: [
            item({ position: 1, payee_id: '', payee_name: '', listing_id: 'l_9', decision: 'needs_approval', pay_status: 'not_paid' }),
            item({ position: 2, decision: 'auto', rule: 'mandate:mdt_1', pay_status: 'completed' }),
            item({ position: 3, payee_name: 'Kite Accounting', payee_id: 'py_2', pay_status: 'held' }),
          ],
        }),
      ],
    })
    await renderRouter('./src/app', { initialUrl: '/approve/preq_1' })
    expect(await screen.findByText('Not paid: a marketplace purchase is not paid from here yet')).toBeTruthy()
    expect(screen.getByText('Paid')).toBeTruthy()
    expect(screen.getByText('Inside a permission you signed: paid without asking you.')).toBeTruthy()
    expect(screen.getByText('Held for 24 hours, as Kite Accounting is a new payee')).toBeTruthy()
    const text = allText()
    expect(text).not.toMatch(/\(|\)|R-APPROVE|mandate/i)
    expect(text).not.toContain('not_paid')
  })
})

describe('B55.4 a browser waiting to approve payments too', () => {
  const enrolment = { id: 'enr_1', kind: 'passkey', name: 'Chrome on Mac', code: '042917', status: 'waiting', created_at: '2026-11-10T10:00:00Z', expires_at: '2026-11-10T10:10:00Z' }
  const asks = 'A browser asks to approve payments too. Let it in only if you are adding it now and its code is 042917.'
  const decisions = (calls: ReturnType<typeof mockBff>) => calls.filter((c) => c.method === 'POST' && c.path.startsWith('/api/agents/keys/enrolments/'))
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
    mockStore.set('talyvor.device-key', 'dev_1')
    mockStore.set('talyvor.device-workspace', 'ws_1')
    mockPhone.face = true
    mockPhone.reasons = []
  })

  test('Let it approve signs the enrolment challenge with Face ID and posts the assertion', async () => {
    const calls = mockBff({ enrolments: [enrolment] })
    await renderRouter('./src/app', { initialUrl: '/approvals' })
    expect(await screen.findByText(asks)).toBeTruthy()
    await fireEvent.press(screen.getByText('Let it approve'))

    await waitFor(() => expect(screen.queryByText(asks)).toBeNull())
    expect(decisions(calls).map((c) => c.path)).toEqual(['/api/agents/keys/enrolments/enr_1/challenge', '/api/agents/keys/enrolments/enr_1/approve'])
    expect(JSON.parse(decisions(calls)[1].body!)).toEqual({ assertion: { device_id: 'dev_1', challenge: 'ch_enr_1', signature: 'signed:talyvor-device-v1:ch_enr_1' } })
    expect(mockPhone.reasons).toEqual(['Let a browser approve payments'])
  })

  test('Not this one turns it away, signing nothing', async () => {
    const calls = mockBff({ enrolments: [enrolment] })
    await renderRouter('./src/app', { initialUrl: '/approvals' })
    await fireEvent.press(await screen.findByText('Not this one'))

    await waitFor(() => expect(screen.queryByText(asks)).toBeNull())
    expect(decisions(calls).map((c) => c.path)).toEqual(['/api/agents/keys/enrolments/enr_1/decline'])
    expect(mockPhone.reasons).toEqual([])
  })
})

describe('B56.12 labels on the phone', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  })
  const preq = { id: 'preq_1', status: 'pending_approval', summary: '', client: 'mcp:claude-desktop', totals: { GBP: 4200 }, items: [{ position: 1, payee_id: 'py_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 4200, reference: 'November hosting', decision: 'needs_approval', reason: 'above the approval amount' }], created_at: '2026-11-09T08:00:00Z' }

  // Each money screen, where it lands, the words that say it has loaded, and how many chips it draws: Home's safe-to-spend,
  // its prepared payment and its approval; Approvals' prepared payment and approval; one on every other screen.
  const screens: [string, string, string, number][] = [
    ['Home', '/', 'Safe to spend', 3],
    ['Approvals', '/approvals', 'Buyer wants to pay GPU hour', 2],
    ['the approval sheet', '/approve/preq_1', 'Acme Hosting', 1],
    ["an agent's approval", '/approvals/apr_1', 'Buyer wants to pay GPU hour', 1],
    ['the statement', '/statement', 'Researcher', 1],
    ["an agent's money", '/agents/ag_1', 'Spent so far: 0 LXC', 1],
  ]

  test.each(screens)('%s says Sandbox or Live as Lens answers, and nothing while it has not', async (_, url, loaded, chips) => {
    for (const state of ['sandbox', 'live'] as const) {
      const calls = mockBff({ requests: [preq], labels: state })
      await renderRouter('./src/app', { initialUrl: url })
      await waitFor(() => expect(screen.getAllByTestId(`money-label-${state}`)).toHaveLength(chips))
      expect(screen.queryByTestId(`money-label-${state === 'live' ? 'sandbox' : 'live'}`)).toBeNull()
      expect(screen.getAllByLabelText(state === 'live' ? 'Live. Moves real money.' : 'Sandbox. Works. No real money moves.')).toHaveLength(chips)
      // One read labels every chip on the screen.
      expect(calls.filter((c) => c.path === '/api/wallets/capabilities')).toHaveLength(1)
    }
    mockBff({ requests: [preq], labels: 'unread' })
    await renderRouter('./src/app', { initialUrl: url })
    expect((await screen.findAllByText(loaded)).length).toBeGreaterThan(0)
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.queryByText('Sandbox')).toBeNull()
  })

  test('a section is Live only when Lens says live for every capability in it, and a capability with no label draws nothing', async () => {
    expect(labelOf({ spend_on_talyvor: 'live', move_between_own_agents: 'live' }, ['spend_on_talyvor', 'move_between_own_agents'])).toBe('live')
    expect(labelOf({ spend_on_talyvor: 'live', move_between_own_agents: 'sandbox' }, ['spend_on_talyvor', 'move_between_own_agents'])).toBe('sandbox')
    expect(labelOf({ spend_on_talyvor: 'live' }, ['spend_on_talyvor', 'move_between_own_agents'])).toBeNull()
    expect(labelOf({ spend_on_talyvor: 'paused' }, ['spend_on_talyvor'])).toBeNull()
    expect(labelOf(undefined, ['spend_on_talyvor'])).toBeNull()
  })

  test("signed out, the label is Lens's public answer from /api/pricing", async () => {
    mockStore.clear()
    const paths: string[] = []
    globalThis.fetch = jest.fn(async (url: string) => {
      paths.push(url.replace('https://bff.test', ''))
      return new Response(JSON.stringify({ plans: [], labels: { payments_out: 'sandbox' } }), { status: 200 })
    }) as unknown as typeof fetch
    const view = await render(
      <SessionProvider>
        <MoneyLabel capability="payments_out" />
      </SessionProvider>,
    )
    expect(await view.findByTestId('money-label-sandbox')).toBeTruthy()
    expect(paths).toEqual(['/api/pricing'])
  })
})

describe('B57.65 the tab bar', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  })
  const preq = { id: 'preq_1', status: 'pending_approval', summary: '', client: 'mcp:claude-desktop', totals: { GBP: 4200 }, items: [], created_at: '2026-11-09T08:00:00Z' }
  // The bar draws each tab's icon twice, on and off, and fades between them.
  const badges = () => screen.queryAllByTestId('approvals-badge').map((b) => within(b).getByText(/\d/).props.children)

  test('each tab has its icon over its word, and pressing it opens it', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    await screen.findByText('1 waiting for you')
    for (const icon of ['home', 'approvals', 'spending', 'statements', 'payments']) expect(screen.getAllByTestId(`icon-${icon}`, { includeHiddenElements: true }).length).toBeGreaterThan(0)
    for (const word of ['Home', 'Approvals', 'Spending', 'Statement', 'Pay']) expect(screen.getAllByText(word).length).toBeGreaterThan(0)
    // Every tab, pressed, is the one you are on: none leads nowhere. Chat's own test opens Chat, with its recorder
    // stood in for, in a workspace that has it (B59.3).
    for (const name of ['Approvals', 'Spending', 'Statement', 'Pay', 'Home']) {
      const label = name === 'Approvals' ? 'Approvals, 1 waiting' : name
      await fireEvent.press(screen.getByRole('button', { name: label }))
      await waitFor(() => expect(screen.getByRole('button', { name: label, selected: true })).toBeTruthy())
    }
  })

  test('the Approvals badge counts agents’ requests and prepared payments, and is gone at zero after a push', async () => {
    const start = { approvals: undefined as unknown[] | undefined, requests: [preq] }
    mockBff(start)
    await renderRouter('./src/app', { initialUrl: '/' })
    expect(await screen.findByText('2 waiting for you')).toBeTruthy()
    await waitFor(() => expect(badges()).toEqual([2, 2]))
    expect(screen.getByLabelText('Approvals, 2 waiting')).toBeTruthy()

    // Both are decided elsewhere; the next push refreshes the badge, and at zero it is not drawn.
    start.approvals = []
    start.requests = []
    const { __receive } = Notifications as unknown as { __receive: (d: Record<string, unknown>) => void }
    __receive({ type: 'agent_approval', approval_id: 'apr_9' })
    await waitFor(() => expect(badges()).toEqual([]))
    expect(screen.getByLabelText('Approvals')).toBeTruthy()
  })
})

describe('B59.3 a hidden area is not there', () => {
  beforeEach(() => {
    mockStore.clear()
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  })
  const chatTab = () => [...screen.queryAllByTestId('icon-chat', { includeHiddenElements: true }), ...screen.queryAllByText('Chat', { includeHiddenElements: true })]

  test('a default workspace has no Chat tab, and a link to Chat opens Home', async () => {
    mockBff({ areas: [] })
    await renderRouter('./src/app', { initialUrl: '/' })
    await screen.findByText('1 waiting for you')
    expect(chatTab()).toHaveLength(0)

    await renderRouter('./src/app', { initialUrl: '/chat' })
    expect(await screen.findByText('1 waiting for you')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Home', selected: true })).toBeTruthy()
    expect(chatTab()).toHaveLength(0)
  })

  test('a workspace whose areas cannot be read has no Chat tab either', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    await screen.findByText('1 waiting for you')
    expect(chatTab()).toHaveLength(0)
  })

})
