import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B59.32 — the phone's company details and the people with control (the web's B59.31, on the phone): a Business sees
// them in Settings and saves the company name, number and country and each person's name, role and share; the shares are
// checked before anything is sent and only the four fields go; a Personal account never sees them and asks nothing.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** The web's strings, typed from suite cd14b62 (apps/web/src/areas/lens/companyDetailsApi.ts and PageLinks.tsx): the
 * phone's screens are checked against these, not against their own copy. */
const WEB = {
  settings: ['Company details', 'Company name, number and country, and the people with control'],
  form: [
    'Company details',
    'These go to our partner’s identity check later. No identity documents are asked for.',
    'Company name',
    'Registration number',
    'Country',
    'People with control',
    'Each director, and anyone who owns or controls part of the company.',
    'Add a person',
    'Save',
  ],
  person: ['Name', 'Role', 'Share', 'Director', 'Shareholder', 'Other', 'Remove'],
  errors: { personName: 'Add their name.', shareRange: 'A share is from 0 to 100%.', sharesTotal: 'The shares come to more than 100%.', companyName: 'Add the company name.' },
  saved: 'Saved',
}

type Details = { company_name: string; registration_number: string; country: string; people: { name: string; role: string; share_bps: number }[] }

/** Lens behind the BFF; `calls` is every request the app made. */
function mockBff({ type = 'business', saved }: { type?: 'business' | 'personal'; saved?: Details } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  let kept: Details = saved ?? { company_name: '', registration_number: '', country: '', people: [] }
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
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/workspace/business':
        if (type === 'personal') return json({ error: 'not a business workspace', code: 'not_business' }, 404)
        return json(kept)
      case 'PUT /api/workspace/business':
        kept = body
        return json(kept)
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return calls
}

const business = (calls: { method: string; path: string; body?: unknown }[]) => calls.filter((c) => c.path === '/api/workspace/business')

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

test("a Business's Settings lists Company details with the web's words, and it opens the form with the web's words", async () => {
  mockBff({ saved: { company_name: 'Northwind Studio Ltd', registration_number: '12345678', country: 'GB', people: [{ name: 'Ana Pop', role: 'director', share_bps: 2500 }] } })
  await renderRouter('./src/app', { initialUrl: '/settings' })
  expect(await screen.findByText(WEB.settings[1])).toBeTruthy()
  await fireEvent.press(screen.getByText(WEB.settings[0]))

  expect(await screen.findByText(WEB.form[1])).toBeTruthy()
  for (const words of WEB.form) expect(screen.getAllByText(words).length).toBeGreaterThan(0)
  const person = within(screen.getByTestId('person-0'))
  for (const words of WEB.person) expect(person.getAllByText(words).length).toBeGreaterThan(0)
  expect(screen.getByLabelText('Company name').props.value).toBe('Northwind Studio Ltd')
  expect(screen.getByLabelText('Registration number').props.value).toBe('12345678')
  expect(screen.getByRole('button', { name: 'Country' }).props.accessibilityValue).toEqual({ text: 'United Kingdom' })
  expect(person.getByLabelText('Name').props.value).toBe('Ana Pop')
  expect(person.getByRole('radio', { name: 'Director' }).props.accessibilityState.checked).toBe(true)
  expect(person.getByLabelText('Share').props.value).toBe('25')
})

test('the form checks each person and the shares before anything is sent, then sends the four fields only', async () => {
  const calls = mockBff({ saved: { company_name: 'Northwind Studio Ltd', registration_number: '12345678', country: 'GB', people: [] } })
  await renderRouter('./src/app', { initialUrl: '/settings/company' })
  await fireEvent.press(await screen.findByText('Add a person'))
  await fireEvent.press(screen.getByText('Add a person'))
  await fireEvent.changeText(within(screen.getByTestId('person-0')).getByLabelText('Share'), '60')
  await fireEvent.changeText(within(screen.getByTestId('person-1')).getByLabelText('Name'), 'Ion Rusu')
  await fireEvent.changeText(within(screen.getByTestId('person-1')).getByLabelText('Share'), '120')
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
  expect(within(screen.getByTestId('person-0')).getByText(WEB.errors.personName)).toBeTruthy()
  expect(within(screen.getByTestId('person-1')).getByText(WEB.errors.shareRange)).toBeTruthy()

  await fireEvent.changeText(within(screen.getByTestId('person-0')).getByLabelText('Name'), 'Ana Pop')
  await fireEvent.changeText(within(screen.getByTestId('person-1')).getByLabelText('Share'), '50.5')
  expect(screen.getByText(WEB.errors.sharesTotal)).toBeTruthy()
  expect(business(calls).filter((c) => c.method === 'PUT')).toEqual([])

  await fireEvent.changeText(within(screen.getByTestId('person-1')).getByLabelText('Share'), '40')
  await fireEvent.press(within(screen.getByTestId('person-1')).getByRole('radio', { name: 'Shareholder' }))
  await fireEvent.changeText(screen.getByLabelText('Company name'), '  Northwind Studio Limited ')
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(WEB.saved)).toBeTruthy()
  expect(business(calls).filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
    {
      company_name: 'Northwind Studio Limited',
      registration_number: '12345678',
      country: 'GB',
      people: [
        { name: 'Ana Pop', role: 'director', share_bps: 6000 },
        { name: 'Ion Rusu', role: 'shareholder', share_bps: 4000 },
      ],
    },
  ])
})

test('a person is removed, and a company with no name is not sent', async () => {
  const calls = mockBff({ saved: { company_name: '', registration_number: '1', country: 'GB', people: [{ name: 'Ana Pop', role: 'other', share_bps: 0 }] } })
  await renderRouter('./src/app', { initialUrl: '/settings/company' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Remove Ana Pop' }))
  expect(screen.queryByTestId('person-0')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByText(WEB.errors.companyName)).toBeTruthy()
  expect(business(calls).filter((c) => c.method === 'PUT')).toEqual([])
})

test('a Personal account has no Company details in Settings, its address opens Home, and nothing is asked', async () => {
  const calls = mockBff({ type: 'personal' })
  await renderRouter('./src/app', { initialUrl: '/settings' })
  expect(await screen.findByText('Personal')).toBeTruthy()
  expect(screen.queryByText(WEB.settings[0])).toBeNull()

  await renderRouter('./src/app', { initialUrl: '/settings/company' })
  await waitFor(() => expect(screen).toHavePathname('/'))
  expect(screen.queryByText(WEB.form[1])).toBeNull()
  expect(business(calls)).toEqual([])
})
