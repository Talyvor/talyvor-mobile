import type { TalyvorKeysNative } from './index'

/**
 * B57.130 — the web export's software test key, behind EXPO_PUBLIC_TALYVOR_TEST_KEYS=1 in a development build only
 * (index.ts refuses it in a release build): a P-256 key made with WebCrypto, with no hardware and no biometric check.
 * It registers as platform `test`, which Lens takes only with LENS_DEVICE_TEST_ATTESTATION=true, so the web export can
 * sign on a test stack. The key is kept for the browser tab, so a reload keeps signing.
 */

const STORE = 'talyvor.test-key.'

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** WebCrypto signs r‖s; Lens, like the phones, reads ASN.1 DER. */
function der(raw: Uint8Array): Uint8Array {
  const int = (x: Uint8Array) => {
    let i = 0
    while (i < x.length - 1 && x[i] === 0) i++
    const v = x.slice(i)
    return v[0] & 0x80 ? [0x02, v.length + 1, 0, ...v] : [0x02, v.length, ...v]
  }
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))]
  return Uint8Array.from([0x30, body.length, ...body])
}

const P256 = { name: 'ECDSA', namedCurve: 'P-256' }
const keys = new Map<string, CryptoKey>()

async function key(alias: string): Promise<CryptoKey | undefined> {
  const kept = keys.get(alias)
  if (kept) return kept
  const jwk = globalThis.sessionStorage?.getItem(STORE + alias)
  if (!jwk) return undefined
  const k = await crypto.subtle.importKey('jwk', JSON.parse(jwk), P256, false, ['sign'])
  keys.set(alias, k)
  return k
}

export const testKey: TalyvorKeysNative & { platform: 'test' } = {
  platform: 'test',
  isAvailable: () => true,
  async createKey(alias) {
    const pair = await crypto.subtle.generateKey(P256, true, ['sign', 'verify'])
    keys.set(alias, pair.privateKey)
    globalThis.sessionStorage?.setItem(STORE + alias, JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)))
    return b64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)))
  },
  // Lens takes a test key with no attestation.
  attest: async () => '',
  async sign(alias, message) {
    const k = await key(alias)
    if (!k) throw Object.assign(new Error('this browser holds no test key'), { code: 'ERR_TALYVOR_KEY' })
    return b64(der(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, new TextEncoder().encode(message)))))
  },
  async deleteKey(alias) {
    keys.delete(alias)
    globalThis.sessionStorage?.removeItem(STORE + alias)
  },
}
