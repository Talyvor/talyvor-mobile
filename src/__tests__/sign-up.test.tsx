/// <reference types="node" />
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

import { palettes } from '@/theme'

// B59.9 — sign-up on the phone shows the web's words (talyvor-suite B59.8, apps/web/src/areas/auth/signupWords.ts at
// a8240e4), asks who the account is for and the kind of money, and its step 3 makes this phone's key with Face ID. B61.21: step 4 is the identity
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
  // B61.20 (suite PR #1120 at 99205a0): step 4, the identity check. B57.174: Pocket Live's su5 names the legal name Full
  // name, and its words (LIVE below) replaced the web's line and the ID document's card.
  identity: {
    checks: ['Email and phone', 'Who you are', 'Your company'],
    labels: { email: 'Email', phone: 'Phone number', legalName: 'Full name', dateOfBirth: 'Date of birth', country: 'Country you live in' },
    // B61.46 (suite PR #1154 at c22e1d39, apps/web/src/areas/auth/signupWords.ts): the home address, sent with the identity check.
    address: { title: 'Home address', line1: 'Address line 1', line2: 'Address line 2', town: 'Town or city', postcode: 'Postcode' },
    run: 'Confirm who I am',
    passedSandbox: 'Passed in Sandbox',
    notPassed: 'Not passed',
    documentTitle: 'Your ID document',
    done: 'You’re confirmed. Your account is open.',
    open: 'Open the app',
    gate: 'Your account can look around but can’t move money until you confirm who you are.',
    finish: 'Finish confirming who you are',
    // B61.118 (suite PR, apps/web/src/areas/auth/signupWords.ts): the way into the app while a check waits or did not pass
    openWaiting: 'You can look around now. Once your identity check passes, you can move money.',
    openNotPassed: 'You can try the check again from Settings, Verification.',
    waiting: 'Waiting for the checker',
    companyFirst: 'Save the company details, with at least one director, first.',
    // B65.2 (suite PR #1192, apps/web/src/areas/auth/signupWords.ts): the identity partner's step
    documentLine: 'Persona, our identity partner, checks a photo of your ID and a selfie for us.',
    privacy: 'Our privacy notice',
    verify: 'Verify your ID',
    again: 'Start again',
    notYet: 'Not checked yet',
    expired: 'Your identity check expired. Start it again.',
    personFailed: 'We couldn’t confirm who you are. Check your full name, date of birth, home address and country, and try again.',
  },
}

/** B57.174 — the identity step's words as Pocket Live draws them (design/pocket-live texts.json 'ph su5', 15 Nov). */
const LIVE = {
  line: 'The law asks us to check. It takes a minute.',
  fullName: 'Full name',
  dateOfBirth: 'Date of birth',
  // B65.3 — the note is the identity partner's line, the web's B65.2 words (suite PR #1192), in su5's place for it.
  note: 'Persona, our identity partner, checks a photo of your ID and a selfie for us.',
}

/** B61.111 — talyvor-lens B61.53's refusal of a country Talyvor does not serve, as the BFF relays it (suite B61.110). */
const COUNTRY_NOT_SERVED = { code: 'country_not_served', error: 'Talyvor is not available in that country yet.', field: 'country' }

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
/** B65.3 — the app's browser sheet: what it was asked to open, and what the person does there before it closes. */
const mockBrowser = { auth: [] as [string, string][], pages: [] as string[], there: () => undefined as void }
jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openAuthSessionAsync: async (url: string, back: string) => {
    mockBrowser.auth.push([url, back])
    mockBrowser.there()
    return { type: 'success', url: `${back}?inquiry-id=inq_1&status=completed` }
  },
  openBrowserAsync: async (url: string) => {
    mockBrowser.pages.push(url)
    return { type: 'dismiss' }
  },
}))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))

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
function mockBff(
  refuseSession = false,
  { failPerson = false, pendingPerson = false, persona = false, personaLink = 'https://inquiry.withpersona.com/verify?inquiry-id=inq_1', level = 'L0', countries = undefined as string[] | undefined, refuseCountry = '', expiredPerson = false, finding = undefined as Record<string, unknown> | undefined } = {},
) {
  const sessions: Record<string, unknown>[] = []
  const devices: unknown[] = []
  const signInKeys: { name: string; device: { challenge: string; public_key: string }; passcode: string }[] = []
  // B61.21 — Lens's identity checks against the Test provider: each level's check passes unless told otherwise.
  const checks: { level: string; subject: string; status: string; test: boolean; link?: string; detail?: string }[] = []
  // B65.3 — a person check Lens sent to Persona, as Lens B65.1 records one that expired
  if (expiredPerson) checks.push({ level: 'L2', subject: 'person', status: 'failed', test: false, detail: 'Your ID check expired. Start it again.' })
  const reads: string[] = []
  const findingChanges: unknown[] = []
  const verified: Record<string, unknown>[] = []
  const company = { company_name: '', registration_number: '', country: '', people: [] as { name: string; role: string; share_bps: number }[] }
  const record = () => ({ level, meaning: '', live_level: 'L0', live_meaning: '', checks: [...checks].reverse() })
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (route === 'GET /api/pricing') return json({ labels: { payments_out: 'sandbox' }, ...(countries ? { countries } : {}) })
    const auth = (init.headers as Record<string, string>).Authorization
    // B61.27 — the sign-up session chooses its account, and the BFF answers the account's session in its place.
    if (route === 'POST /auth/signup/account' && auth === 'Bearer signup-1') {
      sessions.push(JSON.parse(init.body as string))
      if (refuseSession) return json({ error: 'sign-up needs who the account is for' }, 400)
      if (refuseCountry && JSON.parse(init.body as string).country === refuseCountry) return json(COUNTRY_NOT_SERVED, 400)
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
    // B61.94 — how the person is found (BFF B61.93): no finding given is a BFF that does not answer it
    if (route === 'GET /api/people/finding' && finding) return json(finding)
    if (route === 'POST /api/people/finding' && finding) {
      findingChanges.push(JSON.parse(init.body as string))
      return json(Object.assign(finding, JSON.parse(init.body as string)))
    }
    if (route === 'GET /api/workspace/name') return json({ id: 'ws_new', name: 'Maya Lind' })
    // B59.32 — the workspace is what sign-up asked for; only a Business has company details.
    const made = sessions[0] as { account_type?: string; money_kind?: string } | undefined
    if (route === 'GET /api/workspace/account' && made) return json({ account_type: made.account_type, money_kind: made.money_kind })
    if (route === 'GET /api/workspace/business' && made?.account_type === 'business') return json(company)
    if (route === 'PUT /api/workspace/business' && made?.account_type === 'business') return json(Object.assign(company, JSON.parse(init.body as string)))
    if (route.startsWith('GET /api/verification')) {
      reads.push(route)
      return json(record())
    }
    const verify = /^POST \/api\/verification\/(contact|identity|company)$/.exec(route)
    if (verify) {
      const kind = verify[1]
      if (refuseCountry && JSON.parse(init.body as string).country === refuseCountry) return json(COUNTRY_NOT_SERVED, 400)
      verified.push({ kind, ...JSON.parse(init.body as string) })
      const next = { contact: 'L1', identity: 'L2', company: 'L3' }[kind]!
      const failed = kind === 'identity' && failPerson
      // B61.118 — the person check the provider has not decided yet
      const pending = kind === 'identity' && pendingPerson
      // B65.3 — Lens sends a real person's check to Persona: it waits for them at Persona's one-time page
      const atPersona = kind === 'identity' && persona
      const status = failed ? 'failed' : pending || atPersona ? 'pending' : 'completed'
      const check = {
        level: next,
        subject: kind === 'identity' ? 'person' : kind,
        status,
        test: !atPersona,
        method: atPersona ? 'persona' : 'test',
        evidence_ref: `ev_${kind}`,
        ...(atPersona ? { link: personaLink } : {}),
      }
      checks.push(check)
      if (status === 'completed') level = next
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
  /** B65.3 — the person finishes at Persona's page and Persona passes them. */
  const passAtPersona = () => {
    for (const c of checks.filter((c) => c.link)) {
      c.status = 'completed'
      delete c.link
    }
    level = 'L2'
  }
  return { sessions, devices, verified, company, signInKeys, reads, passAtPersona, findingChanges }
}

/** B61.27 — the door's sign-up session, as the keychain keeps it after the app opened again: no passcode in memory. */
const joining = () => mockStore.set('talyvor.session', JSON.stringify({ token: 'signup-1', expires_at: '2099-01-01T00:00:00Z', joining: true }))

beforeEach(() => {
  mockBrowser.auth = []
  mockBrowser.pages = []
  mockBrowser.there = () => undefined
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

/** The identity check's fields: email and phone, full name, date of birth, the home address and the country lived in. */
async function fillYou() {
  const L = WEB.identity.labels
  const A = WEB.identity.address
  await fireEvent.changeText(await screen.findByLabelText(L.email), 'maya@example.test')
  await fireEvent.changeText(screen.getByLabelText(L.phone), '+447700900123')
  await fireEvent.changeText(screen.getByLabelText(L.legalName), 'Maya Lind')
  await fireEvent.changeText(screen.getByLabelText(L.dateOfBirth), '1990-04-21')
  await fireEvent.changeText(screen.getByLabelText(A.line1), '1 High Street')
  await fireEvent.changeText(screen.getByLabelText(A.town), 'London')
  await fireEvent.changeText(screen.getByLabelText(A.postcode), 'N1 9GU')
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
  expect(await screen.findByText(LIVE.line)).toBeTruthy()
  expect(screen.getByText(WEB.identity.checks[0])).toBeTruthy()
  expect(screen.getByText(WEB.identity.checks[1])).toBeTruthy()
  expect(screen.queryByText(WEB.identity.checks[2])).toBeNull()
  expect(screen.queryByText('Company details')).toBeNull()
  // The note says Persona checks the ID and the selfie on its own page: nothing here asks for a file or a photo.
  expect(screen.getByText(LIVE.note)).toBeTruthy()
  expect(texts().filter((t) => t !== LIVE.note).some((t) => /upload|choose a file|take a photo/i.test(t))).toBe(false)
  // No way on to Home until the checks pass.
  expect(screen.queryByRole('button', { name: WEB.identity.open })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()

  await fillYou()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  expect(await screen.findByText(WEB.identity.done)).toBeTruthy()
  expect(bff.verified).toEqual([
    { kind: 'contact', email: 'maya@example.test', phone: '+447700900123' },
    // B61.47 — the home address goes whole with the identity check (Lens B61.45); the empty second line is left out.
    {
      kind: 'identity',
      name: 'Maya Lind',
      country: 'GB',
      date_of_birth: '1990-04-21',
      address: { lines: ['1 High Street'], town: 'London', postcode: 'N1 9GU', country: 'GB' },
      return_to: 'phone',
    },
  ])
  expect(screen.getAllByText(WEB.identity.passedSandbox)).toHaveLength(2)
  // B61.118 — once passed, no line about finishing the check later
  expect(screen.queryByText(WEB.identity.openWaiting)).toBeNull()
  expect(screen.queryByText(WEB.identity.openNotPassed)).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.open }))
  await waitFor(() => expect(screen).toHavePathname('/'))
})

test("B57.174: the identity step is drawn as Pocket Live's su5, its one main button at the foot", async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  expect(await screen.findByText(LIVE.line)).toBeTruthy()
  for (const label of [LIVE.fullName, LIVE.dateOfBirth]) expect(screen.getByLabelText(label)).toBeTruthy()
  expect(screen.getByRole('button', { name: WEB.identity.labels.country })).toBeTruthy()
  expect(screen.getByText(LIVE.note)).toBeTruthy()
  // The note says what the document step does: Persona's own page takes the photos, so there is no card for it.
  expect(screen.queryByText(WEB.identity.documentTitle)).toBeNull()
  // The decision sits at the foot, out of the scroll, as every other step's does.
  const foot = within(screen.getByTestId('screen-footer'))
  expect(foot.getByRole('button', { name: WEB.identity.run })).toBeTruthy()
  // The order the drawing reads in: the line, the fields, then the note. (An empty Country also says its label inside.)
  const order = texts().filter((t) => [LIVE.line, LIVE.fullName, LIVE.dateOfBirth, WEB.identity.labels.country, LIVE.note].includes(t))
  expect([...new Set(order)]).toEqual([LIVE.line, LIVE.fullName, LIVE.dateOfBirth, WEB.identity.labels.country, LIVE.note])
})

test('B61.21: a Business sign-up asks for its company, and opens once the company check passes too', async () => {
  const bff = mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Business', 'Northwind Studio')
  expect(await screen.findByText(LIVE.line)).toBeTruthy()
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

test('B61.21, B61.118: a check that does not pass says what to fix, and still lets the person into the app', async () => {
  const bff = mockBff(false, { failPerson: true })
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  await fillYou()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  expect(await screen.findByText(WEB.identity.personFailed)).toBeTruthy()
  expect(screen.getByText(WEB.identity.notPassed)).toBeTruthy()
  expect(bff.verified.map((v) => v.kind)).toEqual(['contact', 'identity'])
  expect(screen.queryByText(WEB.identity.done)).toBeNull()
  expect(screen).toHavePathname('/sign-up')
  const foot = within(screen.getByTestId('screen-footer'))
  expect(foot.getByText(WEB.identity.openNotPassed)).toBeTruthy()
  // B65.3 — the person check that did not pass is started again
  expect(foot.getByRole('button', { name: WEB.identity.again })).toBeTruthy()
  await fireEvent.press(foot.getByRole('button', { name: WEB.identity.open }))
  await waitFor(() => expect(screen).toHavePathname('/'))
})

test('B61.118: while the person check waits for the checker, the step lets the person into the app and says it finishes in the background', async () => {
  mockBff(false, { pendingPerson: true })
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  await fillYou()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  expect(await screen.findByText(WEB.identity.waiting)).toBeTruthy()
  expect(screen.queryByText(WEB.identity.done)).toBeNull()
  const foot = within(screen.getByTestId('screen-footer'))
  expect(foot.getByText(WEB.identity.openWaiting)).toBeTruthy()
  await fireEvent.press(foot.getByRole('button', { name: WEB.identity.open }))
  await waitFor(() => expect(screen).toHavePathname('/'))
})

/** A pressable's own style, its arrays and pressed-state function flattened. */
const lookOf = (el: { props: { style?: unknown } }) => {
  const s = el.props.style
  return Object.assign({}, ...[typeof s === 'function' ? s({ pressed: false }) : s].flat(Infinity).filter(Boolean)) as Record<string, unknown>
}

test.each([
  ['waits for the checker', { pendingPerson: true }, WEB.identity.openWaiting, WEB.identity.run],
  // B65.3: after a check that did not pass the main button is Start again, the same check started anew.
  ['did not pass', { failPerson: true }, WEB.identity.openNotPassed, WEB.identity.again],
] as const)("B57.193: while the person check %s, the way in is Pocket's foot: its line in a note, the one main button, Open the app the quiet one under it", async (_, opts, line, run) => {
  mockBff(false, opts)
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  await fillYou()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  const wayIn = within(await screen.findByTestId('identity-way-in'))
  // The line is a note, as su5 draws its Sandbox line, not loose grey text.
  expect(within(wayIn.getByTestId('note')).getByText(line)).toBeTruthy()
  const foot = within(screen.getByTestId('screen-footer'))
  const main = foot.getAllByRole('button').filter((b) => lookOf(b).backgroundColor === palettes.light.primary)
  expect(main.map((b) => within(b).getByText(/./).props.children)).toEqual([run])
  // Open the app is su6's "Not now": the ghost button, no fill and no rule round it.
  const open = lookOf(foot.getByRole('button', { name: WEB.identity.open }))
  expect(open.backgroundColor).toBeUndefined()
  expect(open.borderWidth).toBeUndefined()
  // The order su6's dock reads in: the line, the main button, then the quiet one.
  const order = texts().filter((t) => [line, run, WEB.identity.open].includes(t))
  expect(order).toEqual([line, run, WEB.identity.open])
})

test("B65.3: a check waiting at Persona draws Verify your ID, opens Persona's page in the app's browser sheet, and a pass there goes on to Home", async () => {
  const bff = mockBff(false, { persona: true })
  mockBrowser.there = bff.passAtPersona
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  expect(await screen.findByText(WEB.identity.documentLine)).toBeTruthy()
  await fillYou()
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
  // Waiting for the person, not the checker: the one button opens Persona's page, and the fields are done with.
  const foot = within(screen.getByTestId('screen-footer'))
  expect(await foot.findByRole('button', { name: WEB.identity.verify })).toBeTruthy()
  expect(foot.queryByRole('button', { name: WEB.identity.run })).toBeNull()
  expect(screen.queryByLabelText(WEB.identity.labels.legalName)).toBeNull()
  expect(screen.queryByText(WEB.identity.waiting)).toBeNull()
  expect(texts().some((t) => /persona:|inquiry/i.test(t))).toBe(false)
  // Lens sends Persona's page back to the phone's own link (Lens B65.1's "phone").
  expect(bff.verified.at(-1)).toMatchObject({ kind: 'identity', return_to: 'phone' })
  expect(bff.reads.every((r) => r.endsWith('?return_to=phone'))).toBe(true)

  await fireEvent.press(foot.getByRole('button', { name: WEB.identity.verify }))
  expect(mockBrowser.auth).toEqual([['https://inquiry.withpersona.com/verify?inquiry-id=inq_1', 'talyvor://settings/verification']])
  await waitFor(() => expect(screen).toHavePathname('/'))
  // Nothing of Persona's is kept on the phone.
  expect([...mockStore.values()].some((v) => /persona|inq_1/.test(v))).toBe(false)
})

test("B65.3: a link to anywhere but Persona's own pages is never opened", async () => {
  mockBff(false, { persona: true, personaLink: 'https://withpersona.com.evil.example/verify' })
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  await fillYou()
  await fireEvent.press(await screen.findByRole('button', { name: WEB.identity.run }))
  expect(await screen.findByText(WEB.identity.waiting)).toBeTruthy()
  expect(screen.queryByRole('button', { name: WEB.identity.verify })).toBeNull()
  expect(mockBrowser.auth).toEqual([])
})

test('B65.3: our privacy notice opens from the identity step', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/sign-up' })
  await toStepFour('Personal', 'Maya Lind')
  await fireEvent.press(await screen.findByRole('link', { name: WEB.identity.privacy }))
  expect(mockBrowser.pages).toEqual(['https://bff.test/privacy'])
})

test('B65.3: an expired check says so and offers Start again, which starts the check anew at Persona', async () => {
  const bff = mockBff(false, { level: 'L1', expiredPerson: true, persona: true })
  bff.sessions.push({ account_type: 'personal', money_kind: 'hybrid' })
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  await renderRouter('./src/app', { initialUrl: '/settings/verification' })
  expect(await screen.findByText(WEB.identity.expired)).toBeTruthy()
  expect(screen.getByText(WEB.identity.notPassed)).toBeTruthy()
  const foot = within(screen.getByTestId('screen-footer'))
  expect(foot.queryByRole('button', { name: WEB.identity.run })).toBeNull()
  await fireEvent.changeText(screen.getByLabelText(WEB.identity.labels.legalName), 'Maya Lind')
  await fireEvent.changeText(screen.getByLabelText(WEB.identity.labels.dateOfBirth), '1990-04-21')
  await fireEvent.changeText(screen.getByLabelText(WEB.identity.address.line1), '1 High Street')
  await fireEvent.changeText(screen.getByLabelText(WEB.identity.address.town), 'London')
  await fireEvent.changeText(screen.getByLabelText(WEB.identity.address.postcode), 'N1 9GU')
  await fireEvent.press(screen.getByRole('button', { name: WEB.identity.labels.country }))
  await fireEvent.press(screen.getAllByRole('button', { name: 'United Kingdom' }).at(-1)!)
  await fireEvent.press(foot.getByRole('button', { name: WEB.identity.again }))
  expect(await foot.findByRole('button', { name: WEB.identity.verify })).toBeTruthy()
  expect(bff.verified).toEqual([
    {
      kind: 'identity',
      name: 'Maya Lind',
      country: 'GB',
      date_of_birth: '1990-04-21',
      address: { lines: ['1 High Street'], town: 'London', postcode: 'N1 9GU', country: 'GB' },
      return_to: 'phone',
    },
  ])
  expect(screen.queryByText(WEB.identity.expired)).toBeNull()
})

// B57.195 — Persona's step in Pocket: one note, as su5 draws its Sandbox note, with our privacy notice inside it; a check
// that failed or expired is said in Pocket's warning note (.note2.warnnote) at the top of the step, not in the foot.
describe("the identity step's Persona note and Start again, in Pocket (B57.195)", () => {
  test('our privacy notice is the last line of Persona’s note, and the note comes before the checks', async () => {
    mockBff(false, { persona: true })
    await renderRouter('./src/app', { initialUrl: '/sign-up' })
    await toStepFour('Personal', 'Maya Lind')
    const note = within(await screen.findByTestId('partner-note'))
    expect(note.getByText(WEB.identity.documentLine)).toBeTruthy()
    expect(note.getByRole('link', { name: WEB.identity.privacy })).toBeTruthy()
    const order = texts().filter((t) => [WEB.identity.documentLine, WEB.identity.privacy, 'The checks'].includes(t))
    expect(order).toEqual([WEB.identity.documentLine, WEB.identity.privacy, 'The checks'])
  })

  const saidInTheWarning = async (sentence: string) => {
    const warn = await screen.findByTestId('again-note')
    expect(within(warn).getByText(sentence)).toBeTruthy()
    expect(lookOf(warn).backgroundColor).toBe(palettes.light.tangerine50)
    const foot = within(screen.getByTestId('screen-footer'))
    expect(foot.queryByText(sentence)).toBeNull()
    const main = foot.getAllByRole('button').filter((b) => lookOf(b).backgroundColor === palettes.light.primary)
    expect(main.map((b) => within(b).getByText(/./).props.children)).toEqual([WEB.identity.again])
    // the sentence comes straight under the step's line, before the fields
    const order = texts().filter((t) => [LIVE.line, sentence, WEB.identity.labels.legalName].includes(t))
    expect(order).toEqual([LIVE.line, sentence, WEB.identity.labels.legalName])
  }

  test('a check that expired is said in the warning note under the line, and the foot’s main button is Start again', async () => {
    const bff = mockBff(false, { level: 'L1', expiredPerson: true, persona: true })
    bff.sessions.push({ account_type: 'personal', money_kind: 'hybrid' })
    mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
    await renderRouter('./src/app', { initialUrl: '/settings/verification' })
    await saidInTheWarning(WEB.identity.expired)
  })

  test('a check that did not pass is said the same way', async () => {
    mockBff(false, { failPerson: true })
    await renderRouter('./src/app', { initialUrl: '/sign-up' })
    await toStepFour('Personal', 'Maya Lind')
    await fillYou()
    await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
    await saidInTheWarning(WEB.identity.personFailed)
  })
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

// B61.111 — the phone's side of suite B61.110: the pickers offer exactly the countries Lens serves (talyvor-lens B61.53's
// GET /v1/public/countries, carried on the BFF's /api/pricing as `countries`), and Lens's refusal of any other is said on
// the country field.
describe('the countries Lens serves (B61.111)', () => {
  test('sign-up and the identity check offer only the countries Lens serves, by the app’s own names', async () => {
    mockBff(false, { countries: ['FR', 'GB', 'US', 'XK'] })
    await renderRouter('./src/app', { initialUrl: '/sign-up' })
    await fireEvent.press(await screen.findByRole('radio', { name: /^Personal/ }))
    await fireEvent.press(screen.getByRole('button', { name: WEB.labels.country }))
    // Spain is on the app's own list; Lens does not serve it, so it is not offered. A code the app has no name for is
    // shown by its code.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Spain' })).toBeNull())
    for (const name of ['France', 'United Kingdom', 'United States', 'XK']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Germany' })).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: WEB.labels.country }))
    await fireEvent.changeText(screen.getByLabelText(WEB.labels.name), 'Maya Lind')
    await fireEvent.press(screen.getByRole('button', { name: WEB.labels.country }))
    await fireEvent.press(screen.getByRole('button', { name: 'United Kingdom' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await fireEvent.press(await screen.findByRole('radio', { name: /^Hybrid\./ }))
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }))
    await fireEvent.press(await screen.findByRole('button', { name: WEB.identity.labels.country }))
    expect(screen.getByRole('button', { name: 'France' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Spain' })).toBeNull()
  })

  test('a country Lens refuses at sign-up goes back to step 1 with Lens’s sentence on the country field', async () => {
    const bff = mockBff(false, { refuseCountry: 'GB' })
    await renderRouter('./src/app', { initialUrl: '/sign-up' })
    await stepOne('Personal', 'Maya Lind')
    await fireEvent.press(await screen.findByRole('radio', { name: /^Fiat only\./ }))
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    const field = await screen.findByTestId('country-field')
    expect(within(field).getByText(COUNTRY_NOT_SERVED.error)).toBeTruthy()
    expect(screen.getByText(WEB.steps[0])).toBeTruthy()
    // Continue waits for another country.
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.queryByText(WEB.steps[1])).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: WEB.labels.country }))
    await fireEvent.press(screen.getByRole('button', { name: 'France' }))
    expect(screen.queryByText(COUNTRY_NOT_SERVED.error)).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(WEB.steps[1])).toBeTruthy()
    expect(bff.sessions.map((s) => s.country)).toEqual(['GB'])
  })

  test('a country Lens refuses at the identity check puts Lens’s sentence on the country field', async () => {
    const bff = mockBff(false, { refuseCountry: 'GB' })
    await renderRouter('./src/app', { initialUrl: '/sign-up' })
    // Sign-up's own country is France here, so only the identity check sends the refused one.
    await fireEvent.press(await screen.findByRole('radio', { name: /^Personal/ }))
    await fireEvent.changeText(screen.getByLabelText(WEB.labels.name), 'Maya Lind')
    await fireEvent.press(screen.getByRole('button', { name: WEB.labels.country }))
    await fireEvent.press(screen.getByRole('button', { name: 'France' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await fireEvent.press(await screen.findByRole('radio', { name: /^Hybrid\./ }))
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }))
    await fillYou()
    await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
    const field = await screen.findByTestId('country-field')
    expect(within(field).getByText(COUNTRY_NOT_SERVED.error)).toBeTruthy()
    expect(screen.queryByText(WEB.identity.personFailed)).toBeNull()
    expect(bff.verified.map((v) => v.kind)).toEqual(['contact'])
  })
})

describe('B61.94: the end of sign-up asks once whether people may find you, to pay you (Pocket Live su7)', () => {
  const SU7 = {
    question: 'Let people find you?',
    line: 'So people can pay you by your name or phone number.',
    yes: 'Yes, find me',
    yesLine: 'By name or phone number, to pay me.',
    no: 'No',
    noLine: 'People need your account details to pay you.',
    open: 'Open my account',
  }
  const nobodyFinds = () => ({ name: '', email: '', phone: '+447700900123', by_name: false, by_phone: false, by_email: false })

  async function toTheQuestion(finding: Record<string, unknown>) {
    const bff = mockBff(false, { finding })
    await renderRouter('./src/app', { initialUrl: '/sign-up' })
    await toStepFour('Personal', 'Maya Lind')
    await fillYou()
    await fireEvent.press(screen.getByRole('button', { name: WEB.identity.run }))
    await fireEvent.press(await screen.findByRole('button', { name: WEB.identity.open }))
    return bff
  }

  test('the question is asked in su7’s words, and Open my account waits for an answer', async () => {
    const bff = await toTheQuestion(nobodyFinds())
    expect(await screen.findByText(SU7.question)).toBeTruthy()
    expect(screen.getByText(SU7.line)).toBeTruthy()
    expect(screen.getByRole('radio', { name: `${SU7.yes}. ${SU7.yesLine}` }).props.accessibilityState).toMatchObject({ checked: false })
    expect(screen.getByRole('radio', { name: `${SU7.no}. ${SU7.noLine}` }).props.accessibilityState).toMatchObject({ checked: false })
    expect(screen.getByRole('button', { name: SU7.open }).props.accessibilityState).toMatchObject({ disabled: true })
    expect(screen).toHavePathname('/sign-up')
    expect(bff.findingChanges).toEqual([])
  })

  test('Yes, find me switches on finding by phone number, and by name once there is one, then opens Home', async () => {
    const bff = await toTheQuestion({ ...nobodyFinds(), name: 'maya.lind' })
    await fireEvent.press(await screen.findByRole('radio', { name: new RegExp(`^${SU7.yes}`) }))
    await fireEvent.press(screen.getByRole('button', { name: SU7.open }))
    await waitFor(() => expect(screen).toHavePathname('/'))
    expect(bff.findingChanges).toEqual([{ by_name: true, by_phone: true }])
  })

  test('Yes with no Talyvor name yet switches on the phone number alone', async () => {
    const bff = await toTheQuestion(nobodyFinds())
    await fireEvent.press(await screen.findByRole('radio', { name: new RegExp(`^${SU7.yes}`) }))
    await fireEvent.press(screen.getByRole('button', { name: SU7.open }))
    await waitFor(() => expect(screen).toHavePathname('/'))
    expect(bff.findingChanges).toEqual([{ by_phone: true }])
  })

  test('No switches nothing on and opens Home', async () => {
    const bff = await toTheQuestion(nobodyFinds())
    await fireEvent.press(await screen.findByRole('radio', { name: new RegExp(`^${SU7.no}\\.`) }))
    await fireEvent.press(screen.getByRole('button', { name: SU7.open }))
    await waitFor(() => expect(screen).toHavePathname('/'))
    expect(bff.findingChanges).toEqual([])
  })

  test('a person who can already be found is not asked again', async () => {
    const bff = await toTheQuestion({ ...nobodyFinds(), by_phone: true })
    await waitFor(() => expect(screen).toHavePathname('/'))
    expect(screen.queryByText(SU7.question)).toBeNull()
    expect(bff.findingChanges).toEqual([])
  })
})
