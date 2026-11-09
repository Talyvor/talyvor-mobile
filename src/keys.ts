import { BffError, type BffClient, type DeviceAssertion, type DeviceKey, type OutsidePaymentRequest } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import TalyvorKeys from '../modules/talyvor-keys'

// B40.13 — this phone's approval key (modules/talyvor-keys), registered with Lens through the BFF (B40.4). Lens checks
// the key's signature over deviceMessage(challenge); the attestation is bound to the challenge and the public key.

const ALIAS = 'approval'
const DEVICE = 'talyvor.device-key'
const DEVICE_WORKSPACE = 'talyvor.device-workspace'
const DEVICE_WORKSPACE_NAME = 'talyvor.device-workspace-name'

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

/** The workspace's name, or '' while it has none (Lens names it by its id until then) or it cannot be read: the name only
 * words the card, so it never stops a key. */
export const workspaceName = (client: BffClient) => client.workspaceName().then((w) => (w.name === w.id ? '' : w.name), () => '')

/** This phone's key as the signed-in workspace sees it, or null when the phone holds none. Lens takes a key only from the
 * workspace it was made in, so `here` is false for another's; `owner` names that one, '' when the phone never learnt it. */
export async function phoneKey(client: BffClient): Promise<{ id: string; here: boolean; owner: string } | null> {
  const id = await thisPhoneDevice()
  if (!id) return null
  const [{ workspace_id }, made, owner] = await Promise.all([client.me(), SecureStore.getItemAsync(DEVICE_WORKSPACE), SecureStore.getItemAsync(DEVICE_WORKSPACE_NAME)])
  return { id, here: made === workspace_id, owner: owner ?? '' }
}

/** Makes this phone's key, has the person confirm with their biometric, and registers it with Lens. A key another
 * workspace holds is replaced: the phone's hardware holds one. */
export async function turnOnPhoneApprovals(client: BffClient): Promise<DeviceKey> {
  if (!TalyvorKeys) throw new Error('This phone cannot hold an approval key.')
  const [{ workspace_id }, workspace] = await Promise.all([client.me(), workspaceName(client)])
  const { challenge } = await client.deviceChallenge()
  const message = utf8(deviceMessage(challenge))
  try {
    // Android writes its attestation's challenge when it makes the key, before there is a public key to bind.
    const publicKey = await TalyvorKeys.createKey(ALIAS, toBase64url(await sha256(message)))
    const spki = fromBase64url(publicKey)
    const bound = new Uint8Array(message.length + spki.length)
    bound.set(message)
    bound.set(spki, message.length)
    const attestation = await TalyvorKeys.attest(ALIAS, toBase64url(await sha256(bound)))
    const signature = await TalyvorKeys.sign(ALIAS, deviceMessage(challenge), `Approve on this phone with ${biometricName}`)
    const name = Platform.OS === 'ios' ? 'iPhone' : 'Android phone'
    const device = await client.registerDevice({ platform: Platform.OS, name, public_key: publicKey, challenge, signature, attestation })
    await SecureStore.setItemAsync(DEVICE, device.id)
    await SecureStore.setItemAsync(DEVICE_WORKSPACE, workspace_id)
    await SecureStore.setItemAsync(DEVICE_WORKSPACE_NAME, workspace)
    return device
  } catch (err) {
    // Making the key deleted any key before it, so a failed move leaves the phone with none.
    await forgetThisPhone()
    throw err
  }
}

/** This phone's signature over a Lens approval or mandate challenge, after the biometric check; `reason` is shown in it.
 * Only for the workspace the key was made in, since Lens refuses it for any other. */
export async function signWithThisPhone(client: BffClient, challenge: string, reason: string): Promise<DeviceAssertion> {
  const key = await phoneKey(client)
  if (!TalyvorKeys || !key) throw new Error(`Approving with ${biometricName} is not on for this phone.`)
  if (!key.here) throw new Error(`approving with ${biometricName} is off for this workspace.`)
  return { device_id: key.id, challenge, signature: await TalyvorKeys.sign(ALIAS, deviceMessage(challenge), reason) }
}

/** This phone's signature over a payment request's approval statement: Lens's challenge is its SHA-256, so the key signs
 * exactly the statement the screen checked, whatever challenge came with it. */
export async function signStatement(client: BffClient, statement: string, reason: string): Promise<DeviceAssertion> {
  return signWithThisPhone(client, toBase64url(await sha256(utf8(statement))), reason)
}

/** B55.5 — resumes one agent, or every agent when `id` is null, signed with this phone's key when it is on: Lens refuses
 * an unsigned resume once the workspace has any passkey or phone key. A cancelled check sends nothing. Answers null once
 * resumed, or why nothing changed; `onWeb` when Lens wanted a signature this phone could not give. Lens's own sentence is
 * never shown. */
export async function resumeWithThisPhone(client: BffClient, id: string | null, reason: string, onWeb: string): Promise<string | null> {
  const device = (await phoneKey(client))?.here
  try {
    const assertion = device ? await signWithThisPhone(client, (await (id ? client.resumeChallenge(id) : client.resumeAllChallenge())).challenge, reason) : undefined
    await (id ? client.resume(id, assertion) : client.resumeAll(assertion))
    return null
  } catch (err) {
    if (!device && err instanceof BffError && err.status === 403) return onWeb
    return err instanceof BffError && err.status === 401 ? 'Nothing changed. Sign in again, then try again.' : 'Nothing changed. You can try again.'
  }
}

/** At sign-in: the key goes only when the workspace it was made in lists it revoked, or no longer lists it, so Turn on
 * shows. Another workspace's key stays, since it may be the only one that workspace can approve with; so does a failed
 * check. */
export async function recheckPhoneKey(client: BffClient): Promise<void> {
  const id = await thisPhoneDevice()
  if (!id) return
  const [{ workspace_id }, { devices }, owner] = await Promise.all([client.me(), client.devices(), SecureStore.getItemAsync(DEVICE_WORKSPACE)])
  if (owner && owner !== workspace_id) return
  const listed = (devices ?? []).find((d) => d.id === id)
  if (listed && !listed.revoked_at) {
    await SecureStore.setItemAsync(DEVICE_WORKSPACE, workspace_id)
    return SecureStore.setItemAsync(DEVICE_WORKSPACE_NAME, await workspaceName(client))
  }
  // A key turned on before its workspace was stored, and not in this list, may be another workspace's: it stays, and the
  // card reads it as another workspace's.
  if (owner || listed) await forgetThisPhone()
}

/** B54.36 — a payment from this phone, signed: Lens's challenge names exactly this payment, idempotency key included, and
 * the key signs it after the biometric check. null when approving on this phone is off for this workspace; a failed or
 * cancelled check rejects, with ERR_TALYVOR_KEY when the key no longer works (keyGone). */
export async function signPayment(client: BffClient, payment: OutsidePaymentRequest, reason: string): Promise<DeviceAssertion | null> {
  const key = await phoneKey(client)
  if (!TalyvorKeys || !key?.here) return null
  const { challenge } = await client.paymentChallenge(payment)
  return { device_id: key.id, challenge, signature: await TalyvorKeys.sign(ALIAS, deviceMessage(challenge), reason) }
}

/** The key is gone from the phone's hardware, or a new face or fingerprint made it unusable: only Turn on again helps. */
export const keyGone = (err: unknown) => (err as { code?: string } | null)?.code === 'ERR_TALYVOR_KEY'

/** What the person is told when keyGone: where to turn approving on again. */
export const keyGoneText = `${Platform.OS === 'ios' ? 'Face ID' : 'Your fingerprint'} changed on this phone, so its key no longer works. Turn approving on again in Approvals, then try again.`

/** Deletes the key from the phone's hardware, so nothing on this phone can sign again. */
export async function forgetThisPhone(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE)
  await SecureStore.deleteItemAsync(DEVICE_WORKSPACE)
  await SecureStore.deleteItemAsync(DEVICE_WORKSPACE_NAME)
  await TalyvorKeys?.deleteKey(ALIAS)
}
