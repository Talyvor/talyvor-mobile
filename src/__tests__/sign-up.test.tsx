/// <reference types="node" />
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B59.9 — sign-up on the phone shows the web's words (talyvor-suite B59.8, apps/web/src/areas/auth/signupWords.ts at
// a8240e4), asks who the account is for and the kind of money before the identity provider, sends both with the name to
// the BFF's /auth/mobile/session, and its step 3 makes this phone's key with Face ID. B61.21: step 4 is the identity
// check (the web's B61.20), and the app opens on Home only once Lens's checks pass. B61.27: sign-up starts at the door,
// so these steps finish a sign-up session (POST /auth/signup/account), and step 3 is Pocket Live's "Approve with Face ID".

jest.setTimeout(30_000)

/** The web's strings, typed from suite a8240e4: the phone's screen is checked against these, not against its own copy. */
const WEB = {
  steps: ['Who is this account for?', 'Pick the kind of money', 'Add a passkey or pair your phone', 'Confirm who you are'],
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
  // B61.4 (suite PR #1116): the type and the kind are fixed once the account is open; another of either is another account.
  typeNote: 'The type can’t be changed later. To use another type, open another account.',
  kindNote: 'The kind of money can’t be changed later. To use another kind, open another account.',
  // B61.20 (suite PR #1120 at 99205a0): step 4, the identity check.
  identity: {
    intro: {
      personal: 'Talyvor checks who you are before your account can move money. It takes a minute.',
      business: 'Talyvor checks who you are and your company before the account can move money. It takes a minute.',
    },
    checks: ['Email and phone', 'Who you are', 'Your company'],
    labels: { email: 'Email', phone: 'Phone number', legalName: 'Legal name', dateOfBirth: 'Date of birth', country: 'Country you live in' },
    run: 'Confirm who I am',
    passedSandbox: 'Passed in Sandbox',
    notPassed: 'Not passed',
    documentTitle: 'Your ID document',
    documentLine: 'When our identity partner is live, its own screen opens here to photograph your ID. In Sandbox nothing is asked for and nothing is kept.',
    done: 'You’re confirmed. Your account is open.',
    open: 'Open the app',
    gate: 'Your account can look around but can’t move money until you confirm who you are.',
    finish: 'Finish confirming who you are',
    companyFirst: 'Save the company details, with at least one director, first.',
    personFailed: 'We couldn’t confirm who you are. Check your legal name, date of birth and country, and try again.',
  },
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
function mockBff(refuseSession = false, { failPerson = false, level = 'L0' } = {}) {
  const sessions: Record<string, unknown>[] = []
  const devices: unknown[] = []
  const signInKeys: { name: string; device: { challenge: string; public_key: string }; passcode: string }[] = []
  // B61.21 — Lens's identity checks against the Test provider: each level's check passes unless told otherwise.
  const checks: { level: string; subject: string; status: string; test: boolean }[] = []
  const verified: Record<string, unknown>[] = []
  const company = { company_name: '', registration_number: '', country: '', people: [] as { name: string; role: string; share_bps: number }[] }
  const record = () => ({ level, meaning: '', live_level: 'L0', live_meaning: '', checks: [...checks].reverse() })
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (route === 'GET /api/pricing') return json({ labels: { payments_out: 'sandbox' } })
    const auth = (init.headers as Record<string, string>).Authorization
    // B61.27 — the sign-up session chooses its account, and the BFF answers the account's session in its place.
    if (route === 'POST /auth/signup/account' && auth === 'Bearer signup-1') {
      sessions.push(JSON.parse(init.body as string))
      if (refuseSession) return json({ error: 'sign-up needs who the account is for' }, 400)
      return json({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z', account_id: 'ws_new', created: true })
    }
    if (auth !== 'Bearer session-1') return json({}, 401)
    // B61.27 — the one challenge the key is made over, and the person's sign-in key, kept with the passcode as proof.
    if (route === 'POST /auth/passkey/register/challenge') return json({ challenge: 'ch_register' })
    if (route === 'POST /auth/passkey/register') {
      const r = JSON.parse(init.body as string)
      if (r.passcode !== '418263') return json({ error: 'That passcode is not right.', reason: 'wrong_passcode' }, 400)
      signInKeys.push(r)
      return json({ id: 'pk_1', kind: 'device', name: r.name, created_at: '2026-11-16T12:00:00Z' }, 201)
    }
    if (route === 'GET /auth/me') return json({ workspace_id: 'ws_new' })
    if (route === 'GET /api/workspace/name') return json({ id: 'ws_new', name: 'Maya Lind' })
    // B59.32 — the workspace is what sign-up asked for; only a Business has company details.
    const made = sessions[0] as { account_type?: string; money_kind?: string } | undefined
    if (route === 'GET /api/workspace/account' && made) return json({ account_type: made.account_type, money_kind: made.money_kind })
    if (route === 'GET /api/workspace/business' && made?.account_type === 'business') return json(company)
    if (route === 'PUT /api/workspace/business' && made?.account_type === 'business') return json(Object.assign(company, JSON.parse(init.body as string)))
    if (route === 'GET /api/verification') return json(record())
    const verify = /^POST \/api\/verification\/(contact|identity|company)$/.exec(route)
    if (verify) {
      const kind = verify[1]
      verified.push({ kind, ...JSON.parse(init.body as string) })
      const next = { contact: 'L1', identity: 'L2', company: 'L3' }[kind]!
      const failed = kind === 'identity' && failPerson
      const check = { level: next, subject: kind === 'identity' ? 'person' : kind, status: failed ? 'failed' : 'completed', test: true, method: 'test', evidence_ref: `ev_${kind}` }
      checks.push(check)
      if (!failed) level = next
      return json({ check, verification: record() })
    }
    if (route === 'GET /api/money/devices') return json({ devices })
    if (route === 'POST /api/money/devices/challenge') return json({ challenge: 'ch_register' })
    if (route === 'POST /api/money/devices') {
      const r = JSON.parse(init.body as string)
      devices.push({ id: 'dev_1', platform: r.platform, name: r.name })
      return json({ id: 'dev_1', platform: r.platform, name: r.name, person: 'maya@example.test', created_at: '2026-11-11T22:00:00Z' }, 201)
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return { sessions, devices, verified, company, signInKeys }
}

/** B61.27 — the door's sign-up session, as the keychain keeps it after the app opened again: no passcode in memory. */
const joining = () => mockStore.set('talyvor.session', JSON.stringify({ token: 'signup-1', expires_at: '2099-01-01T00:00:00Z', joining: true }))

beforeEach(() => {
  mockStore.clear()
  mockPhone.made = 0
  joining()
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

/** Steps 1 to 3: the answers, the kind of money, and the key left for later; lands on step 4. */
async function toStepFour(type: 'Personal' | 'Business', name: string) {
  await stepOne(type, name)
  await fireEvent.press(await screen.findByRole('radio', { name: /^Hybrid\./ }))
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }))
  expect(await screen.findByText(WEB.steps[3])).toBeTruthy()
}

/** "You" for the identity check: email and phone, legal name, date of birth and the country lived in. */
async function fillYou() {
  const L = WEB.identity.labels
  await fireEvent.changeText(await screen.findByLabelText(L.email), 'maya@example.test')
  await fireEvent.changeText(screen.getByLabelText(L.phone), '+447700900123')
  await fireEvent.changeText(screen.getByLabelText(L.legalName), 'Maya Lind')
  await fireEvent.changeText(screen.getByLabelText(L.dateOfBirth), '1990-04-21')
  await fireEvent.press(screen.getByRole('button', { name: L.country }))
  await fireEvent.press(screen.getAllByRole('button', { name: 'United Kingdom' }).at(-1)!)
}

test("step 1 shows the web's words, and each type asks for its own profile before it continues", async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  expect(await screen.findByText(WEB.steps[0])).toBeTruthy()
  expect(screen.getByText('Step 1 of 4')).toBeTruthy()
  for (const [title, line] of WEB.types) expect(screen.getByRole('radio', { name: `${title}. ${line}` })).toBeTruthy()
  expect(screen.getByText(WEB.typeNote)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

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
  expect(screen.getByText('Step 2 of 4')).toBeTruthy()
  expect(screen.getByText('For Maya Lind, a Personal account.')).toBeTruthy()
  WEB.kinds.forEach(([title, line], i) => {
    expect(screen.getByRole('radio', { name: `${title}. ${line}` })).toBeTruthy()
    for (const item of WEB.lists.personal[i]) expect(screen.getByText(item)).toBeTruthy()
  })
  expect(screen.getByText(WEB.kindNote)).toBeTruthy()
  expect(texts().some((t) => /can become Hybrid/.test(t))).toBe(false)
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
  expect(await screen.findByText('Approve with Face ID')).toBeTruthy()
  expect(bff.sessions).toEqual([expect.objectContaining({ account_type: accountType, money_kind: moneyKind, name, country: 'GB' })])
  await waitFor(() => expect(JSON.parse(mockStore.get('talyvor.session')!)).toMatchObject({ token: 'session-1', joining: false, person: true }))
})

test("B61.27: step 3 makes one key with Face ID, kept as the account's approval key and the person's sign-in key", async () => {
  const bff = mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await stepOne('Personal', 'Maya Lind')
  await fireEvent.press(await screen.findByRole('radio', { name: /^Hybrid\./ }))
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('Approve with Face ID')).toBeTruthy()
  expect(screen.getByText('This phone gets a key that never leaves it. You say yes to payments with a look.')).toBeTruthy()
  expect(screen.getByText('Step 3 of 4')).toBeTruthy()
  expect(screen.getByText('Not now')).toBeTruthy()

  // The app opened again since the passcode was chosen, so Lens's proof is asked for here.
  await fireEvent.press(screen.getByRole('button', { name: 'Turn on Face ID' }))
  expect(await screen.findByText('Enter your passcode')).toBeTruthy()
  for (const d of '418263') await fireEvent.press(screen.getByRole('button', { name: d }))
  expect(await screen.findByText(WEB.steps[3])).toBeTruthy()
  expect(screen.getByText('Step 4 of 4')).toBeTruthy()
  expect(mockPhone.made).toBe(1)
  expect(bff.signInKeys).toEqual([expect.objectContaining({ name: 'iPhone', passcode: '418263', device: expect.objectContaining({ challenge: 'ch_register' }) })])
  expect(bff.devices).toHaveLength(1)
  expect(mockStore.get('talyvor.device-key')).toBe('dev_1')
  expect(mockStore.get('talyvor.signin-key')).toBe('pk_1')
})

test('B59.32, B61.21: at step 4 a Business adds its company details and the people with control', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Business', 'Northwind Studio')
  expect(await screen.findByText('Company details')).toBeTruthy()
  expect(screen.getByText('Add a person')).toBeTruthy()
})

test('B59.32: a Personal sign-up is never asked for company details', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  await waitFor(() => expect((globalThis.fetch as jest.Mock).mock.calls.some(([u]) => String(u).endsWith('/api/workspace/account'))).toBe(true))
  expect(screen.queryByText('Company details')).toBeNull()
  expect((globalThis.fetch as jest.Mock).mock.calls.some(([u]) => String(u).endsWith('/api/workspace/business'))).toBe(false)
})

test('a sign-up the BFF refuses says nothing changed and offers to try again', async () => {
  mockBff(true)
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await stepOne('Personal', 'Maya Lind')
  await fireEvent.press(await screen.findByRole('radio', { name: /^Fiat only\./ }))
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('We couldn’t save that. Nothing changed.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  // The sign-up session stays, to try again with.
  expect(JSON.parse(mockStore.get('talyvor.session')!).token).toBe('signup-1')
  expect(screen.queryByText('Approve with Face ID')).toBeNull()
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

  await stepOne('Personal', 'Maya Lind')
  expect(await screen.findByText(WEB.steps[1])).toBeTruthy()
  // Back is the header's round button, a word only for a screen reader; the foot holds Continue alone.
  expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  expect(screen.queryByText('Back')).toBeNull()
  foot = within(screen.getByTestId('screen-footer'))
  expect(foot.getAllByRole('button').map((b) => b.props.accessibilityLabel ?? within(b).getByText(/./).props.children)).toEqual(['Continue'])

  await fireEvent.press(screen.getByRole('radio', { name: /^Hybrid\./ }))
  await fireEvent.press(foot.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('Approve with Face ID')).toBeTruthy()
  expect(within(screen.getByTestId('screen-footer')).getByRole('button', { name: 'Not now' })).toBeTruthy()
})

test('B61.21: a Personal sign-up ends on the identity step and reaches Home only once the checks pass', async () => {
  const bff = mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  expect(screen.getByText('Step 4 of 4')).toBeTruthy()
  expect(await screen.findByText(WEB.identity.intro.personal)).toBeTruthy()
  expect(screen.getByText(WEB.identity.checks[0])).toBeTruthy()
  expect(screen.getByText(WEB.identity.checks[1])).toBeTruthy()
  expect(screen.queryByText(WEB.identity.checks[2])).toBeNull()
  expect(screen.queryByText('Company details')).toBeNull()
  // The document step is where the partner's own screen will open: in Sandbox it collects nothing.
  expect(screen.getByText(WEB.identity.documentTitle)).toBeTruthy()
  expect(screen.getByText(WEB.identity.documentLine)).toBeTruthy()
  expect(texts().some((t) => /upload|choose a file|take a photo/i.test(t))).toBe(false)
  // No way on to Home until the checks pass.
  expect(screen.queryByRole('button', { name: WEB.identity.open })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()

  await fillYou()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  expect(await screen.findByText(WEB.identity.done)).toBeTruthy()
  expect(bff.verified).toEqual([
    { kind: 'contact', email: 'maya@example.test', phone: '+447700900123' },
    { kind: 'identity', name: 'Maya Lind', country: 'GB', date_of_birth: '1990-04-21' },
  ])
  expect(screen.getAllByText(WEB.identity.passedSandbox)).toHaveLength(2)
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.open }))
  await waitFor(() => expect(screen).toHavePathname('/'))
})

test('B61.21: a Business sign-up asks for its company, and opens once the company check passes too', async () => {
  const bff = mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Business', 'Northwind Studio')
  expect(await screen.findByText(WEB.identity.intro.business)).toBeTruthy()
  expect(screen.getByText(WEB.identity.checks[2])).toBeTruthy()
  await fillYou()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  // Without saved company details the company check is not sent at all.
  expect(await screen.findByText(WEB.identity.companyFirst)).toBeTruthy()
  expect(bff.verified).toEqual([])

  bff.company.company_name = 'Northwind Studio'
  bff.company.registration_number = '12345678'
  bff.company.country = 'GB'
  bff.company.people = [{ name: 'Maya Lind', role: 'director', share_bps: 10000 }]
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  expect(await screen.findByText(WEB.identity.done)).toBeTruthy()
  expect(bff.verified.map((v) => v.kind)).toEqual(['contact', 'identity', 'company'])
  expect(screen.getByRole('button', { name: WEB.identity.open })).toBeTruthy()
})

test('B61.21: a check that does not pass says what to fix, and the account stays on the step', async () => {
  const bff = mockBff(false, { failPerson: true })
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  await fillYou()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  expect(await screen.findByText(WEB.identity.personFailed)).toBeTruthy()
  expect(screen.getByText(WEB.identity.notPassed)).toBeTruthy()
  expect(bff.verified.map((v) => v.kind)).toEqual(['contact', 'identity'])
  expect(screen.queryByText(WEB.identity.done)).toBeNull()
  expect(screen.queryByRole('button', { name: WEB.identity.open })).toBeNull()
  expect(screen).toHavePathname('/sign-up')
})

test('B61.21: Home says the account cannot move money until the check is finished, and leads back to it', async () => {
  const bff = mockBff(false, { level: 'L1' })
  bff.sessions.push({ account_type: 'personal', money_kind: 'hybrid' })
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  await renderRouter('./src/app', { initialUrl: '/' })
  expect(await screen.findByText(WEB.identity.gate)).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.finish }))
  await waitFor(() => expect(screen).toHavePathname('/settings/verification'))
  expect(await screen.findByText(WEB.steps[3])).toBeTruthy()
})
