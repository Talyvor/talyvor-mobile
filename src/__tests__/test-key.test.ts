/// <reference types="node" />
import { createHash, createPublicKey, verify } from 'node:crypto'

// B57.130 — the web export's software test key (EXPO_PUBLIC_TALYVOR_TEST_KEYS=1): on the web it makes a P-256 key, signs
// the registration and later challenges, and registers as platform `test`, which Lens takes only from a test server.

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_: string, b: Uint8Array) => Uint8Array.from(jest.requireActual('node:crypto').createHash('sha256').update(b).digest()).buffer,
  randomUUID: () => 'uuid-1',
}))

type Keys = typeof import('../keys')

/** Lens: hands out a challenge, records the registration and lists the key it made. */
function lens() {
  const registered: Record<string, string>[] = []
  return {
    registered,
    client: {
      me: async () => ({ workspace_id: 'ws_1' }),
      workspaceName: async () => ({ id: 'ws_1', name: 'Acme' }),
      deviceChallenge: async () => ({ challenge: 'chal-1' }),
      registerDevice: async (body: Record<string, string>) => {
        registered.push(body)
        return { id: 'dk_1', platform: body.platform, name: body.name, created_at: '2026-11-13T00:00:00Z' }
      },
      devices: async () => ({ devices: [{ id: 'dk_1' }] }),
    },
  }
}

function load(flag: string | undefined): Keys {
  if (flag === undefined) delete process.env.EXPO_PUBLIC_TALYVOR_TEST_KEYS
  else process.env.EXPO_PUBLIC_TALYVOR_TEST_KEYS = flag
  let keys!: Keys
  jest.isolateModules(() => {
    // The web export: Platform reads web before the key module looks.
    jest.requireActual<typeof import('react-native')>('react-native').Platform.OS = 'web'
    keys = jest.requireActual<Keys>('../keys')
  })
  return keys
}

beforeEach(() => mockStore.clear())
afterEach(() => delete process.env.EXPO_PUBLIC_TALYVOR_TEST_KEYS)

test('with the flag, the web registers a software key as platform test, and it signs challenges that verify', async () => {
  const keys = load('1')
  const { client, registered } = lens()
  const device = await keys.turnOnPhoneApprovals(client as never)
  expect(device).toMatchObject({ id: 'dk_1', platform: 'test' })
  const [body] = registered
  expect(body).toMatchObject({ platform: 'test', challenge: 'chal-1', attestation: '' })
  const key = createPublicKey({ key: Buffer.from(body.public_key, 'base64url'), format: 'der', type: 'spki' })
  expect(key.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
  const verifies = (challenge: string, signature: string) =>
    verify('sha256', Buffer.from(`talyvor-device-v1:${challenge}`), { key, dsaEncoding: 'der' }, Buffer.from(signature, 'base64url'))
  expect(verifies('chal-1', body.signature)).toBe(true)

  const statement = 'Pay Acme Hosting £25.00'
  const assertion = await keys.signStatement(client as never, statement, 'Approve')
  expect(assertion.device_id).toBe('dk_1')
  expect(assertion.challenge).toBe(createHash('sha256').update(statement).digest('base64url'))
  expect(verifies(assertion.challenge, assertion.signature)).toBe(true)
  expect(verifies('another', assertion.signature)).toBe(false)
})

test('without the flag, the web holds no key and registers nothing', async () => {
  const keys = load(undefined)
  const { client, registered } = lens()
  expect(keys.keysAvailable()).toBe(false)
  await expect(keys.turnOnPhoneApprovals(client as never)).rejects.toThrow(/cannot hold an approval key/)
  expect(registered).toEqual([])
})
