import { requireOptionalNativeModule } from 'expo'

/**
 * B40.13 — TalyvorKeys: the approval key, a P-256 key in the Secure Enclave (iPhone) or StrongBox/TEE (Android) that
 * signs only after Face ID or a fingerprint. Every byte string is base64url. A failed or cancelled biometric check
 * rejects with code ERR_BIOMETRIC and signs nothing.
 */
export interface TalyvorKeysNative {
  /** A phone with secure key hardware and a face or fingerprint enrolled. */
  isAvailable(): boolean
  /** Makes the key under alias, replacing any earlier one; answers its SubjectPublicKeyInfo DER. Android writes
   * attestationChallenge into the key's attestation; the iPhone ignores it. */
  createKey(alias: string, attestationChallenge: string): Promise<string>
  /** iPhone: an App Attest attestation object whose clientDataHash is binding. Android: the key's attestation chain. */
  attest(alias: string, binding: string): Promise<string>
  /** ECDSA P-256 over SHA-256 of message's UTF-8 bytes, DER, after the biometric check; reason is shown in the prompt. */
  sign(alias: string, message: string, reason: string): Promise<string>
  deleteKey(alias: string): Promise<void>
}

/** null where the app runs without it: the web and Expo Go. */
export default requireOptionalNativeModule<TalyvorKeysNative>('TalyvorKeys')
