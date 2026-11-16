/// <reference types="node" />
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { router } from 'expo-router'
import { AppState, Linking, StyleSheet, type AppStateStatus } from 'react-native'

// B61.27 — the phone's front door and its lock (suite B61.25's BFF): the number, the texted code, and the passcode, or a
// new one chosen twice that goes on to sign-up; and every time the app opens, or comes back after 2 minutes away, the
// lock: six dots and the number pad, Face ID first once it is on, checked by the BFF, with nothing of the account behind.

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
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_: string, b: Uint8Array) => Uint8Array.from(jest.requireActual('node:crypto').createHash('sha256').update(b).digest()).buffer,
  randomUUID: () => 'uuid-1',
}))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** The phone's key store: Face ID passes unless told to fail. */
const mockPhone = { signed: [] as string[], fail: false }
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  createKey: async () => 'cHVibGljLWtleQ',
  attest: async (_: string, binding: string) => binding,
  sign: async (_: string, message: string) => {
    if (mockPhone.fail) throw Object.assign(new Error('Face ID did not pass'), { code: 'ERR_BIOMETRIC' })
    mockPhone.signed.push(message)
    return `signed:${message}`
  },
  deleteKey: async () => undefined,
}))

const PASSCODE = '418263'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/** The BFF's door and lock (suite B61.25), and enough of the account for Home to draw. */
function mockBff({ known = true, sandboxCode = '482913', waitAfter = 5 } = {}) {
  const calls: { route: string; auth?: string; body?: Record<string, unknown> }[] = []
  const state = { locked: false, wrong: 0, lockAll: false }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const auth = (init.headers as Record<string, string>).Authorization
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined
    calls.push({ route, auth, body })
    if (route === 'GET /api/pricing') return json({ labels: { payments_out: 'sandbox' } })
    if (route === 'GET /auth/me' && !auth) return json({ authenticated: false, google_signin: true })
    if (route === 'POST /auth/phone/start') return json({ expires_at: '2099-01-01T00:00:00Z', sandbox: true, sandbox_code: sandboxCode })
    if (route === 'POST /auth/phone/finish')
      return body?.code === sandboxCode ? json({ check: 'chk_1', has_person: known, expires_at: '2099-01-01T00:00:00Z' }) : json({ error: 'That code is not right.', reason: 'wrong_code' }, 400)
    if (route === 'POST /auth/phone/signin')
      return body?.passcode === PASSCODE ? json({ signed_in: true, signup_unfinished: false, account_id: 'ws_1', token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }) : json({ error: 'That passcode is not right.', reason: 'wrong_passcode' }, 400)
    if (route === 'POST /auth/phone/join') return json({ signed_in: true, signup_unfinished: true, account_id: '', token: 'signup-1', expires_at: '2099-01-01T00:00:00Z' })
    if (auth !== 'Bearer session-1') return json({ error: 'authentication required' }, 401)
    if (route === 'POST /auth/lock') {
      if (body?.state === 'closed') state.locked = true
      return new Response(null, { status: 204 })
    }
    if (route === 'POST /auth/unlock/challenge') return json({ challenge: 'ch_unlock' })
    if (route === 'POST /auth/unlock') {
      if (body?.signature ? body.device_id === 'pk_1' && body.signature === 'signed:talyvor-device-v1:ch_unlock' : body?.passcode === PASSCODE) {
        state.locked = false
        state.wrong = 0
        return new Response(null, { status: 204 })
      }
      if (++state.wrong >= waitAfter)
        return json({ error: 'Too many wrong passcodes. Try again at 2099-01-01T14:05:00Z.', reason: 'passcode_wait', retry_at: '2099-01-01T14:05:00Z' }, 429)
      return json({ error: 'That passcode is not right.', reason: 'wrong_passcode' }, 400)
    }
    // Every other route is the account's: the BFF answers 423 while the lock is shut.
    if (state.locked || state.lockAll) return json({ error: 'Unlock the app with your passcode or Face ID.', reason: 'locked' }, 423)
    if (route === 'GET /auth/me') return json({ workspace_id: 'ws_1' })
    if (route === 'GET /api/workspace/name') return json({ id: 'ws_1', name: 'Maya Lind' })
    if (route === 'GET /api/money/devices') return json({ devices: [] })
    if (route === 'GET /api/money/notices') return json({ settings: {}, notices: [] })
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return { calls, state }
}

/** The app's foreground, as the phone tells it. */
let appState: ((s: AppStateStatus) => void)[] = []
const tellApp = (s: AppStateStatus) => act(async () => appState.forEach((f) => f(s)))

/** A session the door opened, kept in the keychain from the last time the app ran. */
const signedInBefore = () => mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z', person: true }))

const typeDigits = async (digits: string) => {
  for (const d of digits) await fireEvent.press(screen.getByRole('button', { name: d }))
}

beforeEach(() => {
  mockStore.clear()
  mockPhone.signed = []
  mockPhone.fail = false
  appState = []
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, f) => {
    appState.push(f as (s: AppStateStatus) => void)
    return { remove: () => (appState = appState.filter((g) => g !== f)) } as ReturnType<typeof AppState.addEventListener>
  })
})
afterEach(() => jest.restoreAllMocks())

async function toCode() {
  await fireEvent.changeText(await screen.findByLabelText('Phone number'), '7700 900456')
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('Enter the code')).toBeTruthy()
}

test('the door: a known number, its code and its passcode open the app on the account', async () => {
  const bff = mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  expect(await screen.findByText('What’s your phone number?')).toBeTruthy()
  await toCode()
  expect(screen.getByText('We sent it to +44 7700 900456.')).toBeTruthy()
  expect(screen.getByText('In Sandbox no text is sent. Your code is 482 913.')).toBeTruthy()
  // The code field takes what the phone fills in from the text.
  expect(screen.getByLabelText('Code').props.textContentType).toBe('oneTimeCode')
  expect(screen.getByLabelText('Code').props.autoComplete).toBe('sms-otp')
  await fireEvent.changeText(screen.getByLabelText('Code'), '482913')
  expect(await screen.findByText('Enter your passcode')).toBeTruthy()
  await typeDigits('999999')
  expect(await screen.findByText('That passcode is not right.')).toBeTruthy()
  await typeDigits(PASSCODE)
  await waitFor(() => expect(screen).toHavePathname('/'))
  await waitFor(() => expect(screen.queryByText('Enter your passcode')).toBeNull())
  expect(bff.calls.find((c) => c.route === 'POST /auth/phone/start')?.body).toEqual({ phone: '+447700900456' })
  expect(bff.calls.filter((c) => c.route === 'POST /auth/phone/signin').at(-1)?.body).toEqual({ check: 'chk_1', passcode: PASSCODE })
  expect(JSON.parse(mockStore.get('talyvor.session')!)).toEqual({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z', person: true, joining: false })
})

test('the door: a new number chooses a passcode, typed twice, and goes on to sign-up', async () => {
  const bff = mockBff({ known: false })
  await renderRouter('./src/app', { initialUrl: '/' })
  await toCode()
  await fireEvent.changeText(screen.getByLabelText('Code'), '482913')
  expect(await screen.findByText('Choose a passcode')).toBeTruthy()
  expect(screen.getByText('6 digits. You type it each time you open Talyvor on this phone.')).toBeTruthy()
  await typeDigits(PASSCODE)
  expect(await screen.findByText('Type it again')).toBeTruthy()
  await typeDigits('418264')
  expect(await screen.findByText('Those passcodes don’t match. Choose one again.')).toBeTruthy()
  expect(screen.getByText('Choose a passcode')).toBeTruthy()
  expect(bff.calls.some((c) => c.route === 'POST /auth/phone/join')).toBe(false)
  await typeDigits(PASSCODE)
  await screen.findByText('Type it again')
  await typeDigits(PASSCODE)
  expect(await screen.findByText('Who is this account for?')).toBeTruthy()
  expect(bff.calls.find((c) => c.route === 'POST /auth/phone/join')?.body).toEqual({ check: 'chk_1', passcode: PASSCODE })
  expect(JSON.parse(mockStore.get('talyvor.session')!)).toMatchObject({ token: 'signup-1', person: true, joining: true })
})

test('the lock on opening: nothing of the account is drawn behind it, and the passcode opens it', async () => {
  const bff = mockBff()
  signedInBefore()
  await renderRouter('./src/app', { initialUrl: '/' })
  expect(await screen.findByTestId('lock-screen')).toBeTruthy()
  expect(screen.getByText('Enter your passcode')).toBeTruthy()
  // The lock is drawn instead of the app: no tab, no screen of the account, and nothing asked of the account.
  expect(screen.queryByText('Home')).toBeNull()
  expect(screen.queryByText('Approvals')).toBeNull()
  expect(screen.queryByText('Maya Lind')).toBeNull()
  expect(screen.queryByTestId('screen-footer')).toBeNull()
  await waitFor(() => expect(bff.calls.find((c) => c.route === 'POST /auth/lock')?.body).toEqual({ state: 'closed' }))
  expect(bff.calls.filter((c) => c.route.includes(' /api/') && c.route !== 'GET /api/pricing')).toEqual([])
  // Face ID is not on, so the pad has no Face ID key.
  expect(screen.queryByRole('button', { name: 'Face ID' })).toBeNull()

  await typeDigits(PASSCODE)
  await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())
  expect(bff.calls.find((c) => c.route === 'POST /auth/unlock')?.body).toEqual({ passcode: PASSCODE })
})

test('the lock after 2 minutes away, and not before', async () => {
  const bff = mockBff()
  signedInBefore()
  await renderRouter('./src/app', { initialUrl: '/' })
  await screen.findByTestId('lock-screen')
  await typeDigits(PASSCODE)
  await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())

  const real = Date.now
  let now = real()
  await tellApp('background')
  // The app switcher's picture is the mark, not the screen.
  expect(await screen.findByTestId('app-cover')).toBeTruthy()
  await waitFor(() => expect(bff.calls.filter((c) => c.route === 'POST /auth/lock').at(-1)?.body).toEqual({ state: 'away' }))
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  now += 119_000
  await tellApp('active')
  expect(screen.queryByTestId('app-cover')).toBeNull()
  expect(screen.queryByTestId('lock-screen')).toBeNull()

  await tellApp('background')
  now += 120_000
  await tellApp('active')
  expect(await screen.findByTestId('lock-screen')).toBeTruthy()
})

test('a 423 from the BFF shows the lock, whatever the phone believed', async () => {
  const bff = mockBff()
  signedInBefore()
  await renderRouter('./src/app', { initialUrl: '/' })
  await screen.findByTestId('lock-screen')
  await typeDigits(PASSCODE)
  await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())
  bff.state.lockAll = true
  await act(async () => router.push('/settings'))
  expect(await screen.findByTestId('lock-screen')).toBeTruthy()
})

test('Face ID first, once it is on: the lock opens with the sign-in key and no digit typed', async () => {
  const bff = mockBff()
  signedInBefore()
  mockStore.set('talyvor.signin-key', 'pk_1')
  await renderRouter('./src/app', { initialUrl: '/' })
  await waitFor(() => expect(bff.calls.find((c) => c.route === 'POST /auth/unlock')?.body).toEqual({ device_id: 'pk_1', challenge: 'ch_unlock', signature: 'signed:talyvor-device-v1:ch_unlock' }))
  await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())
  expect(mockPhone.signed).toEqual(['talyvor-device-v1:ch_unlock'])
})

test('Face ID that does not pass leaves the passcode, with the Face ID key to try again', async () => {
  mockBff()
  signedInBefore()
  mockStore.set('talyvor.signin-key', 'pk_1')
  mockPhone.fail = true
  await renderRouter('./src/app', { initialUrl: '/' })
  expect(await screen.findByRole('button', { name: 'Face ID' })).toBeTruthy()
  expect(screen.getByTestId('lock-screen')).toBeTruthy()
  mockPhone.fail = false
  await fireEvent.press(screen.getByRole('button', { name: 'Face ID' }))
  await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())
})

test('after five wrong passcodes the lock shows the wait, and the pad is off until it ends', async () => {
  const bff = mockBff()
  signedInBefore()
  await renderRouter('./src/app', { initialUrl: '/' })
  await screen.findByTestId('lock-screen')
  for (let i = 0; i < 4; i++) {
    await typeDigits('000000')
    await screen.findByText('That passcode is not right.')
  }
  await typeDigits('000000')
  expect(await screen.findByText(/^Too many wrong passcodes\. Try again at \d\d:\d\d/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '1' })).toBeDisabled()
  await typeDigits(PASSCODE)
  expect(bff.calls.filter((c) => c.route === 'POST /auth/unlock')).toHaveLength(5)
  expect(screen.getByTestId('lock-screen')).toBeTruthy()
})

test('Forgot your passcode? points to help, from the lock', async () => {
  mockBff()
  signedInBefore()
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  await renderRouter('./src/app', { initialUrl: '/' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Forgot your passcode?' }))
  expect(await screen.findByText('Our help team can set you up with a new one once they have checked it’s you. Write to us from the email on your account.')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'Write to us' }))
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/^mailto:.*I%20forgot%20my%20Talyvor%20passcode/))
  await fireEvent.press(screen.getByRole('button', { name: 'Back to the passcode' }))
  expect(await screen.findByTestId('lock-screen')).toBeTruthy()
})

test('Settings, Security: Face ID off leaves the lock asking for the passcode alone', async () => {
  mockBff()
  signedInBefore()
  mockStore.set('talyvor.signin-key', 'pk_1')
  await renderRouter('./src/app', { initialUrl: '/settings' })
  await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())
  const toggle = await screen.findByRole('switch', { name: 'Unlock with Face ID' })
  expect(toggle.props.accessibilityState.checked).toBe(true)
  await fireEvent.press(toggle)
  await waitFor(() => expect(mockStore.get('talyvor.signin-off')).toBe('1'))
  expect(mockStore.get('talyvor.signin-key')).toBe('pk_1')
})

// B57.185 — the door and the lock as Pocket Live draws them (`su0` to `su2`, `lock`, `sub:security`).

test('the lock is drawn as Pocket Live draws it: the dots under the words, the number pad at the foot, keys 70 high and round', async () => {
  mockBff()
  signedInBefore()
  await renderRouter('./src/app', { initialUrl: '/' })
  const lock = await screen.findByTestId('lock-screen')
  const keys = within(lock).getByTestId('passcode-keys')
  expect(within(keys).getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Delete'])
  expect(StyleSheet.flatten(within(keys).getByRole('button', { name: '5' }).props.style)).toMatchObject({ height: 70, borderRadius: 35 })
  expect(StyleSheet.flatten(keys.props.style)).toMatchObject({ maxWidth: 300 })
})

test('the code is six dots typed with the phone’s own keyboard, and the Sandbox code sits in a note', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/' })
  await toCode()
  const dots = screen.getByTestId('code-dots')
  expect(dots.children).toHaveLength(6)
  await fireEvent.changeText(screen.getByLabelText('Code'), '48')
  const filled = dots.children.map((d) => typeof d !== 'string' && StyleSheet.flatten(d.props.style)?.borderWidth === 0)
  expect(filled).toEqual([true, true, false, false, false, false])
  expect(screen.getByTestId('icon-help', { includeHiddenElements: true })).toBeTruthy()
  expect(screen.getByText('In Sandbox no text is sent. Your code is 482 913.')).toBeTruthy()
})

test('Settings, Security draws Unlock with Face ID with its line, and the passcode’s note with its shield', async () => {
  mockBff()
  signedInBefore()
  mockStore.set('talyvor.signin-key', 'pk_1')
  await renderRouter('./src/app', { initialUrl: '/settings' })
  await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull())
  await screen.findByRole('switch', { name: 'Unlock with Face ID' })
  expect(screen.getByText('This phone’s key never leaves it')).toBeTruthy()
  expect(screen.getByText('Your passcode opens the phone app. It never approves a payment.')).toBeTruthy()
  expect(screen.getByTestId('icon-shield', { includeHiddenElements: true })).toBeTruthy()
})
