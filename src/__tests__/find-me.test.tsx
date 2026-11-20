import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B61.94 — Settings, Profile on the phone: the person's Talyvor name and who can find them, by name, phone number and
// email, each its own switch and off until pressed, as the web's B61.93 (talyvor-suite #1199), through the BFF's
// /api/people/finding. Every switch draws what Lens recorded, and a name Lens refuses is said in Lens's words.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))

/** Lens B61.32's refusals, as cmd/lens/people_handler.go words them and the BFF relays them. */
const TAKEN = 'economy: that Talyvor name is taken: choose another'
const KEPT = 'economy: invalid Talyvor name: that name is kept for Talyvor'

/** The BFF, with Lens's record of how the person is found. Names held by others, and what reads like them, are taken. */
function mockBff(start: Partial<Record<'name' | 'email' | 'phone', string>> = {}) {
  const finding = { name: '', email: '', phone: '+447700900456', by_name: false, by_phone: false, by_email: false, ...start }
  const changes: unknown[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (route) {
      // the lock the app opens behind, for a person's session: 418263 opens it
      case 'POST /auth/lock':
        return new Response(null, { status: 204 })
      case 'POST /auth/unlock':
        return JSON.parse(init.body as string).passcode === '418263' ? new Response(null, { status: 204 }) : json({ error: 'That passcode is not right.' }, 400)
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_maya' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_maya', name: 'Maya Lind' })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/people/finding':
        return json(finding)
      case 'POST /api/people/finding': {
        const ch = JSON.parse(init.body as string) as Partial<typeof finding>
        changes.push(ch)
        if (ch.name !== undefined) {
          const name = ch.name.toLowerCase()
          if (name.includes('talyvor')) return json({ error: KEPT }, 400)
          // "rnaya" reads like "maya", which another person holds
          if (['maya', 'rnaya', 'may.a'].includes(name)) return json({ error: TAKEN }, 409)
          finding.name = name
        }
        for (const k of ['by_name', 'by_phone', 'by_email'] as const) if (ch[k] !== undefined) finding[k] = ch[k]!
        return json(finding)
      }
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return { finding, changes }
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z', person: true }))
})

/** Settings, opened past the lock with the passcode. */
async function openSettings() {
  await renderRouter('./src/app', { initialUrl: '/settings' })
  await screen.findByTestId('lock-screen')
  for (const d of '418263') await fireEvent.press(screen.getByRole('button', { name: d }))
  await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())
}

const card = async () => within(await screen.findByTestId('settings-find-me'))
const toggle = (c: Awaited<ReturnType<typeof card>>, name: string) => c.getByRole('switch', { name })

test('the Talyvor name is saved as Lens keeps it, and Save shows only once it is changed', async () => {
  const bff = mockBff()
  await openSettings()
  const c = await card()
  expect(c.getByText('3 to 20 letters a to z, digits, dots and underscores.')).toBeTruthy()
  expect(c.queryByRole('button', { name: 'Save' })).toBeNull()
  await fireEvent.changeText(c.getByLabelText('Your Talyvor name'), ' Maya.Lind ')
  await fireEvent.press(c.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(c.getByLabelText('Your Talyvor name').props.value).toBe('maya.lind'))
  expect(bff.changes).toEqual([{ name: 'Maya.Lind' }])
  expect(c.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(c.getByText('@maya.lind')).toBeTruthy()
})

test.each([
  ['taken', 'maya', 'That Talyvor name is taken: choose another.'],
  ['reads like a name held', 'rnaya', 'That Talyvor name is taken: choose another.'],
  ['kept for Talyvor', 'talyvor.pay', 'Invalid Talyvor name: that name is kept for Talyvor.'],
])('a name that is %s is refused in Lens’s words, and nothing changes', async (_, name, words) => {
  const bff = mockBff()
  await openSettings()
  const c = await card()
  await fireEvent.changeText(c.getByLabelText('Your Talyvor name'), name)
  await fireEvent.press(c.getByRole('button', { name: 'Save' }))
  expect(await c.findByText(words)).toBeTruthy()
  expect(bff.finding.name).toBe('')
  expect(toggle(c, 'Name').props.accessibilityState).toMatchObject({ checked: false, disabled: true })
})

test('each way to be found is its own switch, off until pressed, and draws what Lens recorded', async () => {
  const bff = mockBff({ name: 'maya.lind', email: 'maya@northwind.example' })
  await openSettings()
  const c = await card()
  expect(c.getByText('Let people find me by')).toBeTruthy()
  for (const [name, by] of [['Name', '@maya.lind'], ['Phone number', '+447700900456'], ['Email', 'maya@northwind.example']] as const) {
    expect(toggle(c, name).props.accessibilityState).toMatchObject({ checked: false })
    expect(c.getByText(by)).toBeTruthy()
  }
  expect(bff.changes).toEqual([])

  await fireEvent.press(toggle(c, 'Phone number'))
  await waitFor(() => expect(toggle(c, 'Phone number').props.accessibilityState).toMatchObject({ checked: true }))
  expect(bff.changes).toEqual([{ by_phone: true }])
  expect(toggle(c, 'Name').props.accessibilityState).toMatchObject({ checked: false })
  expect(toggle(c, 'Email').props.accessibilityState).toMatchObject({ checked: false })

  await fireEvent.press(toggle(c, 'Email'))
  await waitFor(() => expect(toggle(c, 'Email').props.accessibilityState).toMatchObject({ checked: true }))
  await fireEvent.press(toggle(c, 'Name'))
  await waitFor(() => expect(toggle(c, 'Name').props.accessibilityState).toMatchObject({ checked: true }))
  await fireEvent.press(toggle(c, 'Phone number'))
  await waitFor(() => expect(toggle(c, 'Phone number').props.accessibilityState).toMatchObject({ checked: false }))
  expect(bff.changes).toEqual([{ by_phone: true }, { by_email: true }, { by_name: true }, { by_phone: false }])
  expect(bff.finding).toMatchObject({ by_name: true, by_phone: false, by_email: true })
})

test('a way with nothing to be found by cannot be switched on, and says why', async () => {
  mockBff({ phone: '' })
  await openSettings()
  const c = await card()
  expect(c.getByText('Choose your Talyvor name first.')).toBeTruthy()
  expect(c.getByText('Talyvor has no phone number for you yet.')).toBeTruthy()
  expect(c.getByText('Talyvor has no email for you yet.')).toBeTruthy()
  for (const name of ['Name', 'Phone number', 'Email']) expect(toggle(c, name).props.accessibilityState).toMatchObject({ checked: false, disabled: true })
})

test('a session that is not a person’s draws no finding settings', async () => {
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/settings' })
  expect(await screen.findByText('Account ID')).toBeTruthy()
  expect(screen.queryByTestId('settings-find-me')).toBeNull()
  expect((globalThis.fetch as jest.Mock).mock.calls.some(([u]) => String(u).includes('/api/people/finding'))).toBe(false)
})

// B57.204 — drawn as Pocket Live's `sub:profile`, with `sub:security`'s setting rows: the ways to be found in one card
// with a rule between them, and who sees what in the shield note.
test('the ways to be found are drawn as Pocket’s setting rows, with the line in the shield note', async () => {
  mockBff({ name: 'maya.lind', email: 'maya@northwind.example' })
  await openSettings()
  const c = await card()
  const rule = (testID: string) => [c.getByTestId(testID).props.style].flat().find((s: { borderTopWidth?: number } | undefined) => s?.borderTopWidth)
  expect(rule('find-me-by-name')).toBeUndefined()
  expect(rule('find-me-by-phone')).toMatchObject({ borderTopWidth: 1 })
  expect(rule('find-me-by-email')).toMatchObject({ borderTopWidth: 1 })
  expect(within(c.getByTestId('note')).getByText('Someone who finds you sees only your first name and the first letter of your last name.')).toBeTruthy()
})
