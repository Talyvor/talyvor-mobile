import type { BffClient, DeviceAssertion, DeviceKey } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import TalyvorKeys from '../modules/talyvor-keys'

// B40.13 — this phone's approval key (modules/talyvor-keys), registered with Lens through the BFF (B40.4). Lens checks
// the key's signature over deviceMessage(challenge); the attestation is bound to the challenge and the public key.

const ALIAS = 'approval'
const DEVICE = 'talyvor.device-key'

export const biometricName = Platform.OS === 'ios' ? 'Face ID' : 'your fingerprint'

/** What the key signs for a Lens challenge: Lens's devicekey.Message. */
export const deviceMessage = (challenge: string) => `talyvor-device-v1:${challenge}`

const utf8 = (s: string) => new TextEncoder().encode(s)

const sha256 = async (b: Uint8Array<ArrayBuffer>) => new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, b))

function toBase64url(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** A phone with secure key hardware and a face or fingerprint enrolled. */
export const keysAvailable = () => TalyvorKeys?.isAvailable() ?? false

/** The Lens id of this phone's registered key, or null when approving on this phone is off. */
export const thisPhoneDevice = () => SecureStore.getItemAsync(DEVICE)

/** Makes this phone's key, has the person confirm with their biometric, and registers it with Lens. */
export async function turnOnPhoneApprovals(client: BffClient): Promise<DeviceKey> {
  if (!TalyvorKeys) throw new Error('This phone cannot hold an approval key.')
  const { challenge } = await client.deviceChallenge()
  const message = utf8(deviceMessage(challenge))
  // Android writes its attestation's challenge when it makes the key, before there is a public key to bind.
  const publicKey = await TalyvorKeys.createKey(ALIAS, toBase64url(await sha256(message)))
  try {
    const spki = fromBase64url(publicKey)
    const bound = new Uint8Array(message.length + spki.length)
    bound.set(message)
    bound.set(spki, message.length)
    const attestation = await TalyvorKeys.attest(ALIAS, toBase64url(await sha256(bound)))
    const signature = await TalyvorKeys.sign(ALIAS, deviceMessage(challenge), `Approve on this phone with ${biometricName}`)
    const name = Platform.OS === 'ios' ? 'iPhone' : 'Android phone'
    const device = await client.registerDevice({ platform: Platform.OS, name, public_key: publicKey, challenge, signature, attestation })
    await SecureStore.setItemAsync(DEVICE, device.id)
    return device
  } catch (err) {
    await TalyvorKeys.deleteKey(ALIAS)
    throw err
  }
}

/** This phone's signature over a Lens approval or mandate challenge, after the biometric check; `reason` is shown in it. */
export async function signWithThisPhone(challenge: string, reason: string): Promise<DeviceAssertion> {
  const device_id = await thisPhoneDevice()
  if (!TalyvorKeys || !device_id) throw new Error(`Approving with ${biometricName} is not on for this phone.`)
  return { device_id, challenge, signature: await TalyvorKeys.sign(ALIAS, deviceMessage(challenge), reason) }
}

/** This phone's signature over a payment request's approval statement: Lens's challenge is its SHA-256, so the key signs
 * exactly the statement the screen checked, whatever challenge came with it. */
export async function signStatement(statement: string, reason: string): Promise<DeviceAssertion> {
  return signWithThisPhone(toBase64url(await sha256(utf8(statement))), reason)
}

/** On sign-out: the key is deleted from the phone's hardware, so nothing on this phone can sign again. */
export async function forgetThisPhone(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE)
  await TalyvorKeys?.deleteKey(ALIAS)
}
