/// <reference types="node" />
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B59.9 — sign-up on the phone shows the web's words (talyvor-suite B59.8, apps/web/src/areas/auth/signupWords.ts at
// a8240e4), asks who the account is for and the kind of money before the identity provider, sends both with the name to
// the BFF's /auth/mobile/session, and its step 3 makes this phone's key with Face ID.

jest.setTimeout(30_000)

/** The web's strings, typed from suite a8240e4: the phone's screen is checked against these, not against its own copy. */
const WEB = {
  steps: ['Who is this account for?', 'Pick the kind of money', 'Add a passkey or pair your phone'],
  types: [
    ['Personal', 'For you and your own agents.'],
    ['Business', 'For a company and its team.'],
  ],
  kinds: [
    ['Fiat only', 'Your agents pay ordinary bills with cards and bank transfers.'],
    ['Stablecoin and crypto only', 'Your agents work on chain.'],
    ['Hybrid', 'Both side by side, under one set of rules.'],
  ],
  lists: {
    personal: [
      ['Balances in GBP, EUR and USD', 'Cards with Personal art', 'Bank transfers in and out'],
      ['Stablecoin and crypto balances', 'A card that spends from the stablecoin balance', 'Wallet addresses, on-chain send and receive'],
      ['Both balances, one total with the split', 'All cards', 'Convert between the two sides', 'Instant transfer'],
    ],
    business: [['Balances in GBP, EUR and USD', 'Cards with Corporate art', 'Bank transfers in and out']],
  },
  labels: { name: 'Your name', companyName: 'Company name', registrationNumber: 'Registration number', country: 'Country' },
  errors: { name: 'Add your name.', companyName: 'Add the company name.', registrationNumber: 'Add the registration number.', country: 'Pick your country.' },
  typeNote: 'The type can’t be changed later. You can hold several accounts and switch between them.',
  kindNote: 'Fiat only or Stablecoin and crypto only can become Hybrid at any time.',
}

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
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_: string, b: Uint8Array) => Uint8Array.from(jest.requireActual('node:crypto').createHash('sha256').update(b).digest()).buffer,
  randomUUID: () => 'uuid-1',
}))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** The phone's key store: Face ID passes, so the key it makes signs. */
const mockPhone = { made: 0 }
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  createKey: async () => {
    mockPhone.made++
    return 'cHVibGljLWtleQ'
  },
  attest: async (_: string, binding: string) => binding,
  sign: async (_: string, message: string) => `signed:${message}`,
  deleteKey: async () => undefined,
}))

/** The BFF: a new workspace with no key yet, and the sign-up's session once the answers are in. */
function mockBff(refuseSession = false) {
  const sessions: Record<string, unknown>[] = []
  const devices: unknown[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (route === 'GET /api/pricing') return json({ labels: { payments_out: 'sandbox' } })
    if (route === 'POST /auth/mobile/session') {
      sessions.push(JSON.parse(init.body as string))
      if (refuseSession) return json({ error: 'sign-up needs who the account is for' }, 400)
      return json({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' })
    }
    if ((init.headers as Record<string, string>).Authorization !== 'Bearer session-1') return json({}, 401)
    if (route === 'GET /auth/me') return json({ workspace_id: 'ws_new' })
    if (route === 'GET /api/workspace/name') return json({ id: 'ws_new', name: 'Maya Lind' })
    if (route === 'GET /api/money/devices') return json({ devices })
    if (route === 'POST /api/money/devices/challenge') return json({ challenge: 'ch_register' })
    if (route === 'POST /api/money/devices') {
      const r = JSON.parse(init.body as string)
      devices.push({ id: 'dev_1', platform: r.platform, name: r.name })
      return json({ id: 'dev_1', platform: r.platform, name: r.name, person: 'maya@example.test', created_at: '2026-11-11T22:00:00Z' }, 201)
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return { sessions, devices }
}

beforeEach(() => {
  mockStore.clear()
  mockPhone.made = 0
})

const texts = () => screen.getAllByText(/./).map((t) => [t.props.children].flat().join(''))

async function stepOne(type: 'Personal' | 'Business', name: string) {
  await fireEvent.press(await screen.findByRole('radio', { name: new RegExp(`^${type}`) }))
  if (type === 'Personal') await fireEvent.changeText(screen.getByLabelText(WEB.labels.name), name)
  else {
    await fireEvent.changeText(screen.getByLabelText(WEB.labels.companyName), name)
    await fireEvent.changeText(screen.getByLabelText(WEB.labels.registrationNumber), '12345678')
  }
  await fireEvent.press(screen.getByRole('button', { name: WEB.labels.country }))
  await fireEvent.press(screen.getByRole('button', { name: 'United Kingdom' }))
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
}

test('sign-in leads a new person to sign-up', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  await fireEvent.press(await screen.findByText('Create a workspace'))
  expect(await screen.findByText(WEB.steps[0])).toBeTruthy()
})

test("step 1 shows the web's words, and each type asks for its own profile before it continues", async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  expect(await screen.findByText(WEB.steps[0])).toBeTruthy()
  expect(screen.getByText('Step 1 of 3')).toBeTruthy()
  for (const [title, line] of WEB.types) expect(screen.getByRole('radio', { name: `${title}. ${line}` })).toBeTruthy()
  expect(screen.getByText(WEB.typeNote)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  expect(screen.getByText('Sign in instead')).toBeTruthy()

  await fireEvent.press(screen.getByRole('radio', { name: /^Personal/ }))
  expect(screen.getByLabelText(WEB.labels.name)).toBeTruthy()
  expect(screen.getByRole('button', { name: WEB.labels.country })).toBeTruthy()
  expect(screen.queryByLabelText(WEB.labels.companyName)).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByText(WEB.errors.name)).toBeTruthy()
  expect(screen.getByText(WEB.errors.country)).toBeTruthy()
  expect(screen.queryByText(WEB.steps[1])).toBeNull()

  await fireEvent.press(screen.getByRole('radio', { name: /^Business/ }))
  expect(screen.getByLabelText(WEB.labels.companyName)).toBeTruthy()
  expect(screen.getByLabelText(WEB.labels.registrationNumber)).toBeTruthy()
  expect(screen.queryByLabelText(WEB.labels.name)).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByText(WEB.errors.companyName)).toBeTruthy()
  expect(screen.getByText(WEB.errors.registrationNumber)).toBeTruthy()
  // No identity document is asked for.
  expect(texts().some((t) => /passport|identity|document/i.test(t))).toBe(false)
})

test("step 2 shows the web's words for the kind of money, and waits for one", async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await stepOne('Personal', 'Maya Lind')
  expect(await screen.findByText(WEB.steps[1])).toBeTruthy()
  expect(screen.getByText('Step 2 of 3')).toBeTruthy()
  expect(screen.getByText('For Maya Lind, a Personal account.')).toBeTruthy()
  WEB.kinds.forEach(([title, line], i) => {
    expect(screen.getByRole('radio', { name: `${title}. ${line}` })).toBeTruthy()
    for (const item of WEB.lists.personal[i]) expect(screen.getByText(item)).toBeTruthy()
  })
  expect(screen.getByText(WEB.kindNote)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

  await fireEvent.press(screen.getByRole('button', { name: 'Back' }))
  await fireEvent.press(screen.getByRole('radio', { name: /^Business/ }))
  await fireEvent.changeText(screen.getByLabelText(WEB.labels.companyName), 'Northwind Studio')
  await fireEvent.changeText(screen.getByLabelText(WEB.labels.registrationNumber), '12345678')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('For Northwind Studio, a Business account.')).toBeTruthy()
  for (const item of WEB.lists.business[0]) expect(screen.getByText(item)).toBeTruthy()
})

test.each([
  ['Personal', 'personal', 'Fiat only', 'fiat'],
  ['Personal', 'personal', 'Stablecoin and crypto only', 'stablecoin'],
  ['Personal', 'personal', 'Hybrid', 'hybrid'],
  ['Business', 'business', 'Fiat only', 'fiat'],
  ['Business', 'business', 'Stablecoin and crypto only', 'stablecoin'],
  ['Business', 'business', 'Hybrid', 'hybrid'],
] as const)('%s and %s reach the BFF as %s and %s with the name', async (type, accountType, kind, moneyKind) => {
  const bff = mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  const name = type === 'Personal' ? 'Maya Lind' : 'Northwind Studio'
  await stepOne(type, name)
  await fireEvent.press(await screen.findByRole('radio', { name: new RegExp(`^${kind}\\.`) }))
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText(WEB.steps[2])).toBeTruthy()
  expect(bff.sessions).toEqual([{ id_token: 'id-token-1', account_type: accountType, money_kind: moneyKind, name }])
})

test("step 3 makes this phone's key with Face ID, and then the app opens", async () => {
  const bff = mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await stepOne('Personal', 'Maya Lind')
  await fireEvent.press(await screen.findByRole('radio', { name: /^Hybrid\./ }))
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText(WEB.steps[2])).toBeTruthy()
  expect(screen.getByText('Step 3 of 3')).toBeTruthy()
  expect(screen.getByText('Do this later')).toBeTruthy()

  await fireEvent.press(screen.getByText('Turn on'))
  expect(await screen.findByText(/^On\. This phone signs your approvals/)).toBeTruthy()
  expect(mockPhone.made).toBe(1)
  expect(bff.devices).toHaveLength(1)
  expect(mockStore.get('talyvor.device-key')).toBe('dev_1')
  expect(screen.getByRole('button', { name: 'Open the app' })).toBeTruthy()
})

test('a sign-up the BFF refuses says nothing changed and offers to try again', async () => {
  mockBff(true)
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await stepOne('Personal', 'Maya Lind')
  await fireEvent.press(await screen.findByRole('radio', { name: /^Fiat only\./ }))
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('We couldn’t save that. Nothing changed.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  await waitFor(() => expect(mockStore.get('talyvor.session')).toBeUndefined())
  expect(screen.queryByText(WEB.steps[2])).toBeNull()
})

test('B57.135: sign-up is drawn in Pocket: the logo or Back with Sandbox at the top, each type on its card face, the actions held at the foot', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  expect(await screen.findByTestId('money-label-sandbox')).toBeTruthy()
  expect(screen.getByLabelText('Talyvor')).toBeTruthy()
  expect(within(screen.getByRole('radio', { name: /^Personal/ })).getByTestId('choice-face-daily', { includeHiddenElements: true })).toBeTruthy()
  expect(within(screen.getByRole('radio', { name: /^Business/ })).getByTestId('choice-face-team', { includeHiddenElements: true })).toBeTruthy()
  let foot = within(screen.getByTestId('screen-footer'))
  expect(foot.getByRole('button', { name: 'Continue' })).toBeTruthy()
  expect(foot.getByRole('button', { name: 'Sign in instead' })).toBeTruthy()

  await stepOne('Personal', 'Maya Lind')
  expect(await screen.findByText(WEB.steps[1])).toBeTruthy()
  // Back is the header's round button, a word only for a screen reader; the foot holds Continue alone.
  expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  expect(screen.queryByText('Back')).toBeNull()
  foot = within(screen.getByTestId('screen-footer'))
  expect(foot.getAllByRole('button').map((b) => b.props.accessibilityLabel ?? within(b).getByText(/./).props.children)).toEqual(['Continue'])

  await fireEvent.press(screen.getByRole('radio', { name: /^Hybrid\./ }))
  await fireEvent.press(foot.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText(WEB.steps[2])).toBeTruthy()
  expect(within(screen.getByTestId('screen-footer')).getByRole('button', { name: 'Do this later' })).toBeTruthy()
})
