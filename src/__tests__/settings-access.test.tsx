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
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))

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
  const calls: { method: string; path: string; query?: string; body?: unknown }[] = []
  // B28.463 — the roles the owner gave, and Acme's role for ana@acme.test, opened only once that address is proved.
  let given = [{ email: 'lee@northwind.studio', role: 'viewer', signed_in: true, granted_at: '2026-11-20T09:00:00Z', user_id: 'u_lee' }]
  const proved: string[] = []
  let held = [...keys]
  let roster = [
    { id: 'm_1', name: 'Nick', email: 'nick@northwind.studio', role: 'owner', avatar_url: '' },
    { id: 'm_2', name: 'Dana', email: 'dana@northwind.studio', role: 'member', avatar_url: '' },
  ]
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path, query] = url.replace('https://bff.test', '').split('?')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, path, query, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /api/accounts':
        return json({ accounts: [{ id: 'ws_northwind', name: 'Northwind Studio', type, kind: 'fiat', opened_at: '2026-11-01T00:00:00Z', current: true }] })
      case 'GET /api/workspace/roles':
        if (type === 'personal') return json({ error: 'not_business' }, 409)
        return json({ items: given })
      case 'PUT /api/workspace/roles': {
        const { email, role } = body as { email: string; role: string }
        const r = { email, role, signed_in: false, granted_at: '2026-11-25T09:00:00Z', user_id: '' }
        given = [...given.filter((g) => g.email !== email), r]
        return json(r)
      }
      case 'DELETE /api/workspace/roles':
        given = given.filter((g) => g.email !== new URLSearchParams(query).get('email'))
        return new Response(null, { status: 204 })
      case 'GET /api/roles':
        return json({ emails: proved, accounts: proved.includes('ana@acme.test') ? [{ id: 'ws_acme', name: 'Acme Ltd', type: 'business', kind: 'fiat', role: 'approver', email: 'ana@acme.test', current: false }] : [] })
      case 'POST /api/roles/email/code':
        return json({ sent: true, email: (body as { email: string }).email.trim() })
      case 'POST /api/roles/email/check': {
        const { email, code } = body as { email: string; code: string }
        if (code !== '246810') return json({ error: 'That code isn’t right, or it has run out. Ask for a new one.' }, 400)
        proved.push(email)
        return json({ email })
      }
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
      // B57.70: an agent's page in one read (Lens B57.12, BFF B57.20).
      case 'GET /api/agents/ag_1/summary':
        return json({ as_of: '2026-10-17T10:00:00Z', agent: agents[0], month: { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z', spent_ulxc: 0, forecast_ulxc: 0, monthly_limit_ulxc: 0 }, approvals: [], card: { status: 'none' }, currency_accounts: [] })
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

// B28.463 — the phone side of suite B28.70, in the web's words (TeamRoles.tsx): a Business owner gives an email a role,
// sees it with its chip and takes it away after asking; every account proves an email with a code mailed to it and then
// sees the accounts shared with it, each with its role. An address typed and not proved opens nothing.
describe('Roles', () => {
  test('the owner gives an email a role and removes one after asking, in the web’s words', async () => {
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const team = within(await screen.findByTestId('your-team'))
    expect(await team.findByText('lee@northwind.studio')).toBeTruthy()
    expect(team.getByText('Has signed in')).toBeTruthy()
    expect(team.getByText('Viewer')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Give a role' }))
    expect(await screen.findByText('They open your company’s account by proving this email with a code we send to it.')).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText('Email'), ' ana@northwind.studio ')
    await fireEvent.press(screen.getByRole('radio', { name: 'Finance' }))
    expect(screen.getByText('Sees everything, and adds, pays, sends and converts money.')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('give-role-send'))
    expect(await screen.findByText('ana@northwind.studio is now Finance.')).toBeTruthy()
    expect(await team.findByText('Hasn’t signed in yet')).toBeTruthy()
    expect(calls.filter((c) => c.method === 'PUT' && c.path === '/api/workspace/roles').map((c) => c.body)).toEqual([{ email: 'ana@northwind.studio', role: 'finance' }])

    await fireEvent.press(team.getByRole('button', { name: 'Remove lee@northwind.studio' }))
    expect(await screen.findByText('Remove “lee@northwind.studio”?')).toBeTruthy()
    expect(screen.getByText('They can no longer open your company’s account as Viewer.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Remove it' }))
    expect(await screen.findByText('lee@northwind.studio no longer has a role.')).toBeTruthy()
    await waitFor(() => expect(team.queryByText('lee@northwind.studio')).toBeNull())
    expect(calls.filter((c) => c.method === 'DELETE' && c.path === '/api/workspace/roles').map((c) => c.query)).toEqual(['email=lee%40northwind.studio'])
  })

  test('a wrong code shows the web’s line and no shared account; the right one lists it with its role', async () => {
    const calls = mockBff({ type: 'personal' })
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const shared = within(await screen.findByTestId('shared-with-you'))
    expect(shared.getByText('Someone gave a role to your email? Prove it’s yours with a code we send to it, and their account opens from Your accounts.')).toBeTruthy()
    await fireEvent.changeText(shared.getByLabelText('Your email'), 'ana@acme.test')
    await fireEvent.press(shared.getByRole('button', { name: 'Send code' }))
    expect(await shared.findByText('We sent a code to ana@acme.test. It works for 10 minutes.')).toBeTruthy()
    await fireEvent.changeText(shared.getByLabelText('Code'), '111111')
    await fireEvent.press(shared.getByRole('button', { name: 'Confirm' }))
    expect(await shared.findByText('That code isn’t right, or it has run out. Ask for a new one.')).toBeTruthy()
    expect(shared.queryByText('Acme Ltd')).toBeNull()
    expect(shared.queryByText('Approver')).toBeNull()

    await fireEvent.changeText(shared.getByLabelText('Code'), '246810')
    await fireEvent.press(shared.getByRole('button', { name: 'Confirm' }))
    expect(await shared.findByText('Acme Ltd')).toBeTruthy()
    expect(shared.getByText('Approver')).toBeTruthy()
    expect(shared.getByText('Proved: ana@acme.test')).toBeTruthy()
    expect(shared.queryByText('That code isn’t right, or it has run out. Ask for a new one.')).toBeNull()
    expect(calls.filter((c) => c.path === '/api/roles/email/check').map((c) => c.body)).toEqual([
      { email: 'ana@acme.test', code: '111111' },
      { email: 'ana@acme.test', code: '246810' },
    ])
    // A Personal account has no team to give roles in.
    expect(screen.queryByTestId('your-team')).toBeNull()
    expect(calls.some((c) => c.path === '/api/workspace/roles')).toBe(false)
  })
})

// B57.222 — Team and roles and Accounts shared with you, drawn in Pocket as w-members and the web's B57.211 draw them:
// Give a role sits at the end of Your team's heading, each person's signed-in line and role chip sit under their email
// with Remove beside them, and Accounts shared with you is one card, the email and its code under its accounts.
describe('Team and roles in Pocket', () => {
  test('Give a role is Your team’s own, and each role sits under its email', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const card = within(await screen.findByTestId('your-team-card'))
    expect(card.getByText('Your team')).toBeTruthy()
    expect(card.getByRole('button', { name: 'Give a role' })).toBeTruthy()
    const under = within(await card.findByTestId('under:lee@northwind.studio'))
    expect(under.getByText('Has signed in')).toBeTruthy()
    expect(under.getByText('Viewer')).toBeTruthy()
    expect(card.getByRole('button', { name: 'Remove lee@northwind.studio' })).toBeTruthy()
  })

  test('Accounts shared with you is one card, its accounts above the email that proves them', async () => {
    mockBff({ type: 'personal' })
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const card = within(await screen.findByTestId('shared-with-you-card'))
    expect(card.getByText('Someone gave a role to your email? Prove it’s yours with a code we send to it, and their account opens from Your accounts.')).toBeTruthy()
    expect(card.getByLabelText('Your email')).toBeTruthy()
    expect(card.getByRole('button', { name: 'Send code' })).toBeTruthy()
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
