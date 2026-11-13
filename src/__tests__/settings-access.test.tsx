import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B59.39 — Settings' security keys, team and roles, and limits (launch pack 1.9, 3.4 and 7): every passkey and phone key by
// name, removed with the web's words and never the last; a Business's members and their roles, and adding one; and each
// agent's limits from its rules. A Personal account never sees the team and never asks for it.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** The web's strings, typed from suite e97fb79 (apps/web/src/areas/lens/AgentBank.tsx FaceID, RemoveKey.tsx and
 * Members.tsx): the phone is checked against these, not against its own copy. */
const WEB = {
  twoKeys: '1 passkey and your phone’s key are registered. You approve with one of them; nothing is approved without one.',
  lastKey: 'It is your last key. With none, nobody could approve, so add another first.',
  remove: { title: 'Remove “Nick’s Mac”?', line: 'It can no longer approve anything.', keep: 'Keep it', go: 'Remove it' },
  removed: 'Removed: Nick’s Mac. It can no longer approve anything.',
  addLine: 'Add someone by the email they sign in with. Each person takes one of your plan’s seats.',
  added: 'ana@northwind.studio was added as a member.',
  ownerRequired: 'Only an owner of this workspace can add members.',
}

type Key = { kind: 'passkey' | 'phone'; id: string; name: string; platform: string; created_at: string; last_used_at?: string }
const mac: Key = { kind: 'passkey', id: 'cred_mac', name: 'Nick’s Mac', platform: '', created_at: '2026-10-14T09:00:00Z', last_used_at: '2026-11-10T09:00:00Z' }
const phone: Key = { kind: 'phone', id: 'dev_1', name: 'iPhone', platform: 'ios', created_at: '2026-11-01T09:00:00Z' }

const agents = [
  { id: 'ag_1', name: 'Research', balance_ulxc: 5_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
  { id: 'ag_2', name: 'Sales', balance_ulxc: 2_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
]
const rules = (o: Record<string, number>) => ({
  max_per_request_ulxc: 0,
  daily_limit_ulxc: 0,
  monthly_limit_ulxc: 0,
  approval_above_ulxc: 0,
  allowed_models: null,
  allowed_providers: null,
  active_from: '',
  active_until: '',
  timezone: '',
  ...o,
})

/** Lens and Track behind the BFF; `calls` is every request the app made. */
function mockBff({ type = 'business', keys = [mac, phone], addRefusal }: { type?: 'business' | 'personal'; keys?: Key[]; addRefusal?: { status: number; code: string } } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  let held = [...keys]
  let roster = [
    { id: 'm_1', name: 'Nick', email: 'nick@northwind.studio', role: 'owner', avatar_url: '' },
    { id: 'm_2', name: 'Dana', email: 'dana@northwind.studio', role: 'member', avatar_url: '' },
  ]
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, path, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_northwind' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_northwind', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type: type, money_kind: 'fiat' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 7_000_000, allocated_ulxc: 7_000_000, unallocated_ulxc: 0, spent_ulxc: 0, agents })
      case 'GET /api/agents/ag_1/rules':
        return json(rules({ max_per_request_ulxc: 2_000_000, daily_limit_ulxc: 10_000_000 }))
      case 'GET /api/agents/ag_2/rules':
        return json(rules({}))
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/money/devices':
        return json({ devices: [] })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/agents/keys':
        return json({ keys: held })
      case 'DELETE /api/agents/passkeys':
        held = held.filter((k) => k.id !== (body as { credential_id: string }).credential_id)
        return json({ removed: true })
      case 'POST /api/money/devices/dev_1/revoke':
        held = held.filter((k) => k.id !== 'dev_1')
        return json({ ...phone, revoked_at: '2026-11-11T12:00:00Z' })
      case 'GET /api/members':
        if (type === 'personal') return json({ error: 'no' }, 404)
        return json(roster)
      case 'POST /api/members': {
        if (addRefusal) return json({ error: 'refused', code: addRefusal.code }, addRefusal.status)
        const { email, role } = body as { email: string; role: string }
        const m = { id: 'm_3', name: email, email, role, avatar_url: '' }
        roster = [...roster, m]
        return json(m, 201)
      }
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-11T12:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'nextTick'] })
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})
afterEach(() => jest.useRealTimers())

describe('Security keys', () => {
  test('lists every key by name with the web’s line, and removes a passkey after asking in the web’s words', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const keys = within(await screen.findByTestId('security-keys'))
    expect(keys.getByText('Security keys')).toBeTruthy()
    expect(await keys.findByText(WEB.twoKeys)).toBeTruthy()
    expect(keys.getByText('Nick’s Mac')).toBeTruthy()
    expect(keys.getByText('Passkey · added 14 Oct · last used yesterday')).toBeTruthy()
    expect(keys.getByText('iPhone')).toBeTruthy()
    expect(keys.getByText('Phone key · added 1 Nov · never used')).toBeTruthy()

    await fireEvent.press(keys.getByLabelText('Remove Nick’s Mac'))
    expect(await screen.findByText(WEB.remove.title)).toBeTruthy()
    expect(screen.getByText(WEB.remove.line)).toBeTruthy()
    expect(screen.getByText(WEB.remove.keep)).toBeTruthy()
    await fireEvent.press(screen.getByText(WEB.remove.go))
    expect(await screen.findByText(WEB.removed)).toBeTruthy()
    expect(calls.filter((c) => c.method === 'DELETE' && c.path === '/api/agents/passkeys').map((c) => c.body)).toEqual([{ credential_id: 'cred_mac' }])
    // The phone's key is now the last, so it offers no Remove.
    await waitFor(() => expect(screen.queryByLabelText('Remove iPhone')).toBeNull())
    expect(screen.getByText(WEB.lastKey)).toBeTruthy()
  })

  test('a phone key is revoked, not deleted as a passkey', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    await fireEvent.press(await screen.findByLabelText('Remove iPhone'))
    await fireEvent.press(await screen.findByText(WEB.remove.go))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/money/devices/dev_1/revoke')).toBe(true))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  test('the last key says why it cannot go, and offers no Remove', async () => {
    mockBff({ keys: [mac] })
    await renderRouter('./src/app', { initialUrl: '/settings' })
    expect(await screen.findByText(WEB.lastKey)).toBeTruthy()
    expect(screen.queryByLabelText('Remove Nick’s Mac')).toBeNull()
  })
})

describe('Team and roles', () => {
  test('a Business sees each member and their role, and adds one by email as a member', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const team = within(await screen.findByTestId('team-and-roles'))
    expect(team.getByText('Team and roles')).toBeTruthy()
    expect(await team.findByText('Nick')).toBeTruthy()
    expect(team.getByText('nick@northwind.studio')).toBeTruthy()
    expect(team.getByText('Owner')).toBeTruthy()
    expect(team.getByText('dana@northwind.studio')).toBeTruthy()
    expect(team.getByText('Member')).toBeTruthy()
    await fireEvent.press(team.getByText('Add member'))
    expect(await screen.findByText(WEB.addLine)).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText('Email'), ' ana@northwind.studio ')
    await fireEvent.press(screen.getByTestId('add-member-send'))
    expect(await team.findByText(WEB.added)).toBeTruthy()
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/members').map((c) => c.body)).toEqual([{ email: 'ana@northwind.studio', role: 'member' }])
  })

  test('an owner is added as an owner, and a refusal is told in the web’s words', async () => {
    const calls = mockBff({ addRefusal: { status: 403, code: 'OWNER_REQUIRED' } })
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const team = within(await screen.findByTestId('team-and-roles'))
    await fireEvent.press(await team.findByText('Add member'))
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'ana@northwind.studio')
    await fireEvent.press(screen.getByRole('radio', { name: 'Owner' }))
    await fireEvent.press(screen.getByTestId('add-member-send'))
    expect(await screen.findByText(WEB.ownerRequired)).toBeTruthy()
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/members').map((c) => c.body)).toEqual([{ email: 'ana@northwind.studio', role: 'owner' }])
  })

  test('a Personal account sees no team, not even greyed, and never asks for one', async () => {
    const calls = mockBff({ type: 'personal' })
    await renderRouter('./src/app', { initialUrl: '/settings' })
    expect(await screen.findByTestId('security-keys')).toBeTruthy()
    expect(await screen.findByTestId('limits')).toBeTruthy()
    expect(screen.queryByTestId('team-and-roles')).toBeNull()
    expect(screen.queryByText('Team and roles')).toBeNull()
    expect(calls.some((c) => c.path === '/api/members')).toBe(false)
  })
})

// B57.154 — drawn in Pocket as w-security, w-members and p-approvals draw the same things: the keys under the shield's
// "Approvals are signed", each key on its kind's tile with a cloud Remove; each member on their initial with their role
// as a chip, and Add member opening Pocket's bottom sheet; each agent's limits beside its face.
describe('Settings’ access in Pocket', () => {
  test('the keys sit under the shield’s heading, each on its kind’s tile', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const keys = within(await screen.findByTestId('security-keys'))
    expect(await keys.findByText('Approvals are signed')).toBeTruthy()
    expect(keys.getByTestId('key-tile-passkey-cred_mac')).toBeTruthy()
    expect(keys.getByTestId('key-tile-phone-dev_1')).toBeTruthy()
  })

  test('each member is drawn on their initial with their role as a chip, and Add member opens the sheet', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const team = within(await screen.findByTestId('team-and-roles'))
    expect(await team.findByText('nick@northwind.studio')).toBeTruthy()
    expect(team.getByTestId('member-m_1-initial')).toBeTruthy()
    expect(within(team.getByTestId('member-m_1-role')).getByText('Owner')).toBeTruthy()
    expect(within(team.getByTestId('member-m_2-role')).getByText('Member')).toBeTruthy()
    // The form waits behind Add member, as w-members keeps it behind its button.
    expect(team.queryByLabelText('Email')).toBeNull()
    await fireEvent.press(team.getByText('Add member'))
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'ana@northwind.studio')
    await fireEvent.press(screen.getByTestId('add-member-send'))
    expect(await team.findByText(WEB.added)).toBeTruthy()
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/members').map((c) => c.body)).toEqual([{ email: 'ana@northwind.studio', role: 'member' }])
  })

  test('each agent’s limits sit beside its face', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const limits = within(await screen.findByTestId('limits'))
    expect(await limits.findByLabelText('Research agent')).toBeTruthy()
    expect(limits.getByLabelText('Sales agent')).toBeTruthy()
  })
})

describe('Limits', () => {
  test('each agent’s limits from its rules, and a press opens the agent', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const limits = within(await screen.findByTestId('limits'))
    expect(limits.getByText('Limits')).toBeTruthy()
    expect(await limits.findByText('Research')).toBeTruthy()
    expect(limits.getByText(/Spends at most .* on one request\. Spends at most .* a day\./)).toBeTruthy()
    expect(limits.getByText('Sales')).toBeTruthy()
    expect(limits.getByText('No limits: it can spend everything it holds.')).toBeTruthy()
    await fireEvent.press(limits.getByText('Research'))
    expect(await screen.findByText('Rules')).toBeTruthy()
  })
})
