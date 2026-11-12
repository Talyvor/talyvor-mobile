import { createHash, createPublicKey, verify } from 'node:crypto'
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

import { approvalHref } from '../push'

// B55.55 — the phone's half of Lens's B55.48, in the web's words (B55.54): the workspace's first key comes with a
// recovery code, shown once and never kept on the phone; a recovery started without it shows on Home, and is cancelled
// there.

jest.setTimeout(30_000)

const CODE = 'ABCD1234EFGH5678JKMN'

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
const mockCopied: string[] = []
jest.mock('expo-clipboard', () => ({ setStringAsync: async (s: string) => (mockCopied.push(s), true) }))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_: string, b: Uint8Array) => Uint8Array.from(jest.requireActual('node:crypto').createHash('sha256').update(b).digest()).buffer,
  randomUUID: () => 'uuid-1',
}))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
jest.mock('../../modules/talyvor-keys', () => {
  const nodeCrypto = jest.requireActual('node:crypto')
  const keys = new Map()
  const b64 = (b: Buffer) => b.toString('base64url')
  return {
    isAvailable: () => true,
    createKey: async (alias: string) => {
      const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      keys.set(alias, privateKey)
      return b64(publicKey.export({ type: 'spki', format: 'der' }))
    },
    attest: async (_: string, binding: string) => binding,
    sign: async (alias: string, message: string) => b64(nodeCrypto.sign('sha256', Buffer.from(message), { key: keys.get(alias), dsaEncoding: 'der' })),
    deleteKey: async (alias: string) => void keys.delete(alias),
  }
})

const message = (challenge: string) => Buffer.from(`talyvor-device-v1:${challenge}`)

/** Lens behind the BFF: the phone's key is the workspace's first, so its registration answers the recovery code once;
 * `recovery` is the waiting recovery GET …/keys/recover answers, until it is cancelled. */
function mockLens(recovery: object | null = null) {
  const calls: string[] = []
  let waiting = recovery
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${url.replace('https://bff.test', '')}`
    calls.push(route)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (route === 'GET /auth/me') return json({ workspace_id: 'ws_1' })
    if (route === 'GET /api/workspace/name') return json({ id: 'ws_1', name: 'Acme' })
    if (route === 'POST /api/money/devices/challenge') return json({ challenge: 'ch_register' })
    if (route === 'POST /api/money/devices') {
      const r = JSON.parse(init.body as string)
      const spki = Buffer.from(r.public_key, 'base64url')
      const key = createPublicKey({ key: spki, format: 'der', type: 'spki' })
      const binding = createHash('sha256').update(Buffer.concat([message(r.challenge), spki])).digest('base64url')
      if (r.attestation !== binding || !verify('sha256', message(r.challenge), { key, dsaEncoding: 'der' }, Buffer.from(r.signature, 'base64url')))
        return json({ error: 'The device key is not valid.' }, 400)
      return json({ id: 'dev_1', platform: r.platform, name: r.name, person: 'owner@acme.test', created_at: '2026-11-12T16:00:00Z', recovery_code: CODE }, 201)
    }
    if (route === 'GET /api/agents/keys/recover') return json({ recovery: waiting })
    if (route === 'POST /api/agents/keys/recover/cancel') {
      waiting = null
      return json({ recovery: { ...recovery, status: 'cancelled' } })
    }
    if (route === 'GET /api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
    if (route === 'GET /api/agents/approvals') return json({ approvals: [] })
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockCopied.length = 0
})

test('the first Turn on shows the recovery code once, with Copy and I saved it, and the phone keeps nothing of it', async () => {
  mockLens()
  await renderRouter('./src/app', { initialUrl: '/approvals' })
  await fireEvent.press(await screen.findByText('Turn on'))
  expect(await screen.findByText('Save your recovery code')).toBeTruthy()
  expect(screen.getByText('If you ever lose every passkey and phone, this code lets you add a new key at once. We show it only now.')).toBeTruthy()
  expect(screen.getByText('ABCD 1234 EFGH 5678 JKMN')).toBeTruthy()
  // On, but not said so until the code is put away.
  expect(screen.queryByText(/^On\. This phone signs your approvals/)).toBeNull()

  await fireEvent.press(screen.getByText('Copy'))
  expect(mockCopied).toEqual([CODE])
  await fireEvent.press(screen.getByText('I saved it'))
  expect(await screen.findByText(/^On\. This phone signs your approvals/)).toBeTruthy()
  expect(screen.queryByText('ABCD 1234 EFGH 5678 JKMN')).toBeNull()
  expect([...mockStore.values()].some((v) => v.replace(/\s/g, '').includes(CODE))).toBe(false)

  // Opened again, the card never shows it.
  await renderRouter('./src/app', { initialUrl: '/approvals' })
  expect(await screen.findByText(/^On\. This phone signs your approvals/)).toBeTruthy()
  expect(screen.queryByText('Save your recovery code')).toBeNull()
})

test('a waiting recovery shows on Home in the web’s words, and Cancel recovery ends it', async () => {
  const calls = mockLens({
    id: 'rec_1',
    status: 'waiting',
    created_at: '2026-11-12T12:00:00Z',
    ready_at: '2026-11-15T12:00:00Z',
    expires_at: '2026-11-16T12:00:00Z',
    mine: false,
  })
  await renderRouter('./src/app', { initialUrl: '/' })
  expect(await screen.findByText(/^The owner started a recovery\. A new key can be added from 15 Nov 2026 at \d\d:\d\d\.$/)).toBeTruthy()
  await fireEvent.press(screen.getByText('Cancel recovery'))
  await waitFor(() => expect(screen.queryByText(/started a recovery/)).toBeNull())
  expect(calls).toContain('POST /api/agents/keys/recover/cancel')
})

test('the push for a started recovery opens Home, where its card is', () => {
  expect(approvalHref({ type: 'key_recovery_started', workspace_id: 'ws_1' })).toBe('/')
})
