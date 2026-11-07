/// <reference types="node" />
import { createHash, createPublicKey, generateKeyPairSync, verify, type KeyObject } from 'node:crypto'
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

import { signWithThisPhone } from '../keys'

// B40.13 DONE: with the platform key store and the biometric check mocked (simulators have no Secure Enclave), the module
// creates a key, registers it with a mocked Lens, signs a payload that verifies against the registered public key, and
// refuses to sign when the biometric check fails.

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

/** The phone's key store: keys by alias, usable only when the biometric check passes. */
const mockPhone = { keys: new Map<string, KeyObject>(), face: true }
jest.mock('../../modules/talyvor-keys', () => {
  const nodeCrypto = jest.requireActual('node:crypto')
  const b64 = (b: Buffer) => b.toString('base64url')
  return {
    isAvailable: () => true,
    createKey: async (alias: string) => {
      const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      mockPhone.keys.set(alias, privateKey)
      return b64(publicKey.export({ type: 'spki', format: 'der' }))
    },
    // The iPhone's App Attest object carries the binding as its clientDataHash; here it is the binding itself.
    attest: async (_: string, binding: string) => binding,
    sign: async (alias: string, message: string) => {
      const key = mockPhone.keys.get(alias)
      if (!key) throw new Error('this phone has no approval key')
      if (!mockPhone.face) throw Object.assign(new Error('Face ID or Touch ID did not confirm, so nothing was signed'), { code: 'ERR_BIOMETRIC' })
      return b64(nodeCrypto.sign('sha256', Buffer.from(message), { key, dsaEncoding: 'der' }))
    },
    deleteKey: async (alias: string) => void mockPhone.keys.delete(alias),
  }
})

const message = (challenge: string) => Buffer.from(`talyvor-device-v1:${challenge}`)

/** Lens behind the BFF, checking a registration as devicekey.VerifyRegistration does for its test platform. */
function mockLens() {
  const registered: { id: string; spki: Buffer }[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (route === 'GET /auth/me') return json({ workspace_id: 'ws_1' })
    if (route === 'POST /api/money/devices/challenge') return json({ challenge: 'ch_register' })
    if (route === 'POST /api/money/devices') {
      const r = JSON.parse(init.body as string)
      const spki = Buffer.from(r.public_key, 'base64url')
      const key = createPublicKey({ key: spki, format: 'der', type: 'spki' })
      const binding = createHash('sha256').update(Buffer.concat([message(r.challenge), spki])).digest('base64url')
      if (r.challenge !== 'ch_register' || r.attestation !== binding || !verify('sha256', message(r.challenge), { key, dsaEncoding: 'der' }, Buffer.from(r.signature, 'base64url')))
        return json({ error: 'devicekey: the device key is not valid' }, 400)
      registered.push({ id: 'dev_1', spki })
      return json({ id: 'dev_1', platform: r.platform, name: r.name, person: 'owner@acme.test', created_at: '2026-10-23T16:00:00Z' }, 201)
    }
    if (route === 'GET /api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (route === 'GET /api/agents/approvals') return json({ approvals: [] })
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return registered
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockPhone.keys.clear()
  mockPhone.face = true
})

test('Turn on makes a key, registers it with Lens, and the key then signs an approval that verifies against it', async () => {
  const registered = mockLens()
  await renderRouter('./src/app', { initialUrl: '/approvals' })
  await fireEvent.press(await screen.findByText('Turn on'))
  expect(await screen.findByText(/^On\. This phone signs your approvals/)).toBeTruthy()
  expect(registered.map((d) => d.id)).toEqual(['dev_1'])
  expect(mockStore.get('talyvor.device-workspace')).toBe('ws_1')

  const a = await signWithThisPhone('ch_approval_1', 'Approve 2 LXC to GPU hour')
  expect(a.device_id).toBe('dev_1')
  const key = createPublicKey({ key: registered[0].spki, format: 'der', type: 'spki' })
  expect(verify('sha256', message('ch_approval_1'), { key, dsaEncoding: 'der' }, Buffer.from(a.signature, 'base64url'))).toBe(true)
  // A signature over one challenge says nothing about another.
  expect(verify('sha256', message('ch_approval_2'), { key, dsaEncoding: 'der' }, Buffer.from(a.signature, 'base64url'))).toBe(false)
})

test('when the biometric check fails, nothing is signed and nothing is registered', async () => {
  const registered = mockLens()
  mockPhone.face = false
  await renderRouter('./src/app', { initialUrl: '/approvals' })
  await fireEvent.press(await screen.findByText('Turn on'))
  expect(await screen.findByText('Not turned on: Face ID or Touch ID did not confirm, so nothing was signed')).toBeTruthy()
  expect(registered).toEqual([])
  expect(mockPhone.keys.size).toBe(0)

  // A registered phone whose owner then fails the check signs nothing either.
  mockStore.set('talyvor.device-key', 'dev_1')
  mockPhone.keys.set('approval', generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey)
  await expect(signWithThisPhone('ch_approval_1', 'Approve')).rejects.toMatchObject({ code: 'ERR_BIOMETRIC' })
})

/** The BFF after this phone's session has ended: every call is a 401 until the person signs in again to `workspace`,
 * whose Lens then lists `devices`. Returns what the phone still held each time the list was read. */
function mockExpiredSession(devices: { id: string; revoked_at?: string }[], workspace = 'ws_1') {
  let token = ''
  const keysWhenListed: number[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (route === 'POST /auth/mobile/session') return json({ token: (token = 'session-2'), expires_at: '2099-01-01T00:00:00Z' })
    if ((init.headers as Record<string, string>).Authorization !== `Bearer ${token}` || !token) return json({}, 401)
    if (route === 'GET /auth/me') return json({ workspace_id: workspace })
    if (route === 'GET /api/money/devices') {
      keysWhenListed.push(mockPhone.keys.size)
      return json({ devices: devices.map((d) => ({ platform: 'ios', name: 'iPhone', person: 'owner@acme.test', created_at: '2026-10-23T16:00:00Z', ...d })) })
    }
    if (route === 'GET /api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (route === 'GET /api/agents/approvals') return json({ approvals: [] })
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return keysWhenListed
}

/** This phone holds dev_1's key, turned on in `workspace`. */
const holdKey = (workspace = 'ws_1') => {
  mockStore.set('talyvor.device-key', 'dev_1')
  mockStore.set('talyvor.device-workspace', workspace)
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  mockPhone.keys.set('approval', privateKey)
  return publicKey
}

/** Home gets a 401, so the app signs out; the key must still be on the phone then. */
async function signedOutOnHome() {
  await renderRouter('./src/app', { initialUrl: '/' })
  const signIn = await screen.findByText('Sign in')
  expect(mockPhone.keys.has('approval')).toBe(true)
  expect(mockStore.get('talyvor.device-key')).toBe('dev_1')
  expect(mockStore.has('talyvor.session')).toBe(false)
  return signIn
}

test('a 401 on Home signs out but keeps the key, and after signing in again with the key listed an approval signs with it', async () => {
  const publicKey = holdKey()
  const keysWhenListed = mockExpiredSession([{ id: 'dev_1' }])
  await fireEvent.press(await signedOutOnHome())
  await waitFor(() => expect(keysWhenListed).toEqual([1]))
  await waitFor(() => expect(mockStore.get('talyvor.session')).toContain('session-2'))
  expect(mockPhone.keys.has('approval')).toBe(true)

  const a = await signWithThisPhone('ch_approval_1', 'Approve')
  expect(a.device_id).toBe('dev_1')
  expect(verify('sha256', message('ch_approval_1'), { key: publicKey, dsaEncoding: 'der' }, Buffer.from(a.signature, 'base64url'))).toBe(true)
})

test.each([
  ['revoked', [{ id: 'dev_1', revoked_at: '2026-11-01T00:00:00Z' }]],
  ['missing', [{ id: 'dev_2' }]],
])('after signing in with the key %s in its workspace, the phone deletes it and Turn on shows', async (_, devices) => {
  holdKey()
  const keysWhenListed = mockExpiredSession(devices)
  await fireEvent.press(await signedOutOnHome())
  await waitFor(() => expect(mockPhone.keys.size).toBe(0))
  // Deleted only once Lens's list was read, with the key still there.
  expect(keysWhenListed).toEqual([1])
  expect(mockStore.has('talyvor.device-key')).toBe(false)
  expect(mockStore.has('talyvor.device-workspace')).toBe(false)
  await fireEvent.press(await screen.findByText('Approvals'))
  expect(await screen.findByText('Turn on')).toBeTruthy()
})

test("signing in to another workspace keeps the key the first workspace still holds", async () => {
  holdKey('ws_a')
  const keysWhenListed = mockExpiredSession([], 'ws_b')
  await fireEvent.press(await signedOutOnHome())
  await waitFor(() => expect(mockStore.get('talyvor.session')).toContain('session-2'))
  await waitFor(() => expect(keysWhenListed).toEqual([1]))
  expect(mockPhone.keys.has('approval')).toBe(true)
  expect(mockStore.get('talyvor.device-key')).toBe('dev_1')
  expect(mockStore.get('talyvor.device-workspace')).toBe('ws_a')
})
