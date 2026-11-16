import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B61.10 — the account switcher on the phone, as the web's B61.9: Home's pill opens "Your accounts", which lists each of
// the person's accounts with the current one marked; a row moves the session to that account (the BFF's
// POST /api/accounts/switch, suite B61.8), and "Open another account" runs sign-up's steps and lands in the new one. The
// BFF below holds who each session token is on, as the real one does, so a screen that kept the old token would read
// the account left behind.

jest.setTimeout(60_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

interface Workspace {
  id: string
  name: string
  type: 'business' | 'personal'
  kind: 'fiat' | 'stablecoin' | 'hybrid'
  level: string
}

const NORTHWIND: Workspace = { id: 'ws_northwind', name: 'Northwind Studio', type: 'business', kind: 'hybrid', level: 'L3' }
const MAYA: Workspace = { id: 'ws_maya', name: 'Maya Lind', type: 'personal', kind: 'fiat', level: 'L2' }

/** The BFF: `accounts` is the person's, first opened first; `on` is which account each session token is on. */
function mockBff(accounts: Workspace[]) {
  const on = new Map<string, string>([['session-1', accounts[0].id]])
  const calls: { method: string; path: string; token: string; body?: Record<string, string> }[] = []
  let minted = 1
  const move = (to: string) => {
    const token = `session-${++minted}`
    on.set(token, to)
    return { account_id: to, token, expires_at: '2099-01-01T00:00:00Z' }
  }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const method = init.method ?? 'GET'
    const token = ((init.headers ?? {}) as Record<string, string>).Authorization?.replace('Bearer ', '') ?? ''
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, string>) : undefined
    calls.push({ method, path, token, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    const ws = accounts.find((a) => a.id === on.get(token))
    if (!ws) return json({ error: 'authentication required' }, 401)
    switch (`${method} ${path}`) {
      case 'GET /api/accounts':
        return json({ accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, kind: a.kind, opened_at: '2026-11-01T00:00:00Z', current: a.id === ws.id })) })
      case 'POST /api/accounts/switch':
        if (!accounts.some((a) => a.id === body?.account_id)) return json({ error: 'no such account' }, 404)
        on.delete(token)
        return json(move(body!.account_id))
      case 'POST /api/accounts': {
        const opened: Workspace = { id: `ws_${accounts.length + 1}`, name: body!.name, type: body!.type as Workspace['type'], kind: body!.kind as Workspace['kind'], level: 'L2' }
        accounts.push(opened)
        on.delete(token)
        return json({ ...move(opened.id), created: true })
      }
      case 'GET /auth/me':
        return json({ workspace_id: ws.id })
      case 'GET /api/workspace/name':
        return json({ id: ws.id, name: ws.name })
      case 'GET /api/workspace/account':
        return json({ workspace_id: ws.id, account_type: ws.type, money_kind: ws.kind })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/verification':
        return json({ level: ws.level, meaning: '', live_level: ws.level, live_meaning: '', checks: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/money/accounts':
        return json({ accounts: [] })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return { calls, accounts }
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

const openSheet = async () => {
  await fireEvent.press(await screen.findByRole('button', { name: 'Switch account. Northwind Studio, Business · Hybrid' }))
  return within(await screen.findByTestId('your-accounts'))
}

describe('Your accounts', () => {
  test('the pill lists both accounts, each with its chip, the one this session is on marked Current', async () => {
    mockBff([NORTHWIND, MAYA])
    await renderRouter('./src/app', { initialUrl: '/' })
    const sheet = await openSheet()
    expect(sheet.getByText('Your accounts')).toBeTruthy()
    const rows = await sheet.findAllByTestId('account-row')
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual(['Northwind Studio, Business · Hybrid, Current', 'Maya Lind, Personal · Fiat'])
    expect(within(rows[0]).getByText('Current')).toBeTruthy()
    expect(within(rows[1]).queryByText('Current')).toBeNull()
    expect(sheet.getByRole('button', { name: 'Open another account' })).toBeTruthy()
    expect(sheet.getByText('Each account has one kind of money. Another kind is another account.')).toBeTruthy()
  })

  test('a row switches: the session takes the new token and Home reads the other account, with its words', async () => {
    const { calls } = mockBff([NORTHWIND, MAYA])
    await renderRouter('./src/app', { initialUrl: '/' })
    expect(await screen.findByText('Your company’s total')).toBeTruthy()
    const sheet = await openSheet()
    await fireEvent.press((await sheet.findAllByTestId('account-row'))[1])
    expect(await screen.findByRole('button', { name: 'Switch account. Maya Lind, Personal · Fiat' })).toBeTruthy()
    expect(await screen.findByText('Your total')).toBeTruthy()
    expect(calls.find((c) => c.path === '/api/accounts/switch')?.body).toEqual({ account_id: 'ws_maya' })
    expect(JSON.parse(mockStore.get('talyvor.session')!).token).toBe('session-2')
    const after = calls.slice(calls.findIndex((c) => c.path === '/api/accounts/switch') + 1)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((c) => c.token === 'session-2')).toBe(true)
  })

  test('Settings: the sentence’s "open another account" opens Your accounts', async () => {
    mockBff([NORTHWIND, MAYA])
    await renderRouter('./src/app', { initialUrl: '/settings' })
    const kind = await screen.findByTestId('settings-money-kind')
    await fireEvent.press(within(kind).getByRole('link', { name: 'open another account' }))
    const sheet = within(await screen.findByTestId('your-accounts'))
    expect(await sheet.findAllByTestId('account-row')).toHaveLength(2)
  })

  test('Open another account: a Personal account opened beside a Business one, and the app lands in it', async () => {
    const { calls, accounts } = mockBff([NORTHWIND])
    await renderRouter('./src/app', { initialUrl: '/' })
    const sheet = await openSheet()
    await fireEvent.press(sheet.getByRole('button', { name: 'Open another account' }))
    expect(await screen.findByLabelText('Step 1 of 3, Who is this account for?')).toBeTruthy()
    expect(screen.queryByText('Sign in instead')).toBeNull()
    await fireEvent.press(screen.getByRole('radio', { name: /^Personal\./ }))
    await fireEvent.changeText(screen.getByLabelText('Your name'), 'Maya Lind')
    await fireEvent.press(screen.getByRole('button', { name: 'Country' }))
    await fireEvent.press(await screen.findByText('United Kingdom'))
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByLabelText('Step 2 of 3, Pick the kind of money')).toBeTruthy()
    await fireEvent.press(screen.getByRole('radio', { name: /^Fiat only\./ }))
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByLabelText(/^Step 3 of 3, /)).toBeTruthy()

    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/accounts')?.body).toEqual({ type: 'personal', kind: 'fiat', name: 'Maya Lind', country: 'GB' })
    expect(accounts.map((a) => [a.name, a.type, a.kind])).toEqual([
      ['Northwind Studio', 'business', 'hybrid'],
      ['Maya Lind', 'personal', 'fiat'],
    ])
    await fireEvent.press(await screen.findByRole('button', { name: 'Open the app' }))
    expect(await screen.findByRole('button', { name: 'Switch account. Maya Lind, Personal · Fiat' })).toBeTruthy()
    expect(await screen.findByText('Your total')).toBeTruthy()
    await waitFor(() => expect(calls.at(-1)?.token).toBe('session-2'))
  })
})
