import DeviceCheck
import ExpoModulesCore
import LocalAuthentication
import Security

// B40.13 — the approval key: P-256 in the Secure Enclave, usable only after Face ID or Touch ID with the fingerprints
// or face enrolled when it was made (.biometryCurrentSet). Its private half never leaves the Enclave; Lens gets the
// public key as SubjectPublicKeyInfo DER and an App Attest attestation whose clientDataHash is the registration's binding.

// The DER prefix that turns an X9.63 P-256 point into SubjectPublicKeyInfo.
private let p256SPKIHeader: [UInt8] = [
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,
  0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]

final class KeyException: GenericException<String> {
  override var code: String { "ERR_TALYVOR_KEY" }
  override var reason: String { param }
}

final class BiometricException: GenericException<String> {
  override var code: String { "ERR_BIOMETRIC" }
  override var reason: String { param }
}

private func base64url(_ d: Data) -> String {
  d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

private func fromBase64url(_ s: String) -> Data? {
  var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  b += String(repeating: "=", count: (4 - b.count % 4) % 4)
  return Data(base64Encoded: b)
}

private func tag(_ alias: String) -> Data { Data("com.talyvor.keys.\(alias)".utf8) }

private func privateKey(_ alias: String, context: LAContext?) -> SecKey? {
  var q: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag(alias),
    kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    kSecReturnRef as String: true,
  ]
  if let context { q[kSecUseAuthenticationContext as String] = context }
  var item: CFTypeRef?
  guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let item else { return nil }
  return (item as! SecKey)
}

public final class TalyvorKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TalyvorKeys")

    // True on a phone with a Secure Enclave and Face ID or Touch ID enrolled; the simulator has no Enclave.
    Function("isAvailable") { () -> Bool in
      #if targetEnvironment(simulator)
        return false
      #else
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
      #endif
    }

    // Makes the key, replacing any earlier one under alias, and answers its public key, base64url SPKI DER.
    // attestationChallenge is Android's; the iPhone binds its attestation in attest().
    AsyncFunction("createKey") { (alias: String, _: String) -> String in
      SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag(alias)] as CFDictionary)
      var err: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                                                         [.privateKeyUsage, .biometryCurrentSet], &err) else {
        throw KeyException("the key's access control could not be made")
      }
      let attrs: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: tag(alias),
          kSecAttrAccessControl as String: access,
        ],
      ]
      guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &err), let pub = SecKeyCopyPublicKey(key),
            let point = SecKeyCopyExternalRepresentation(pub, &err) as Data? else {
        throw KeyException("the Secure Enclave did not make the key: \(err?.takeRetainedValue().localizedDescription ?? "unknown")")
      }
      return base64url(Data(p256SPKIHeader) + point)
    }

    // Apple's App Attest attestation object, base64url, with binding (base64url SHA-256) as its clientDataHash.
    AsyncFunction("attest") { (_: String, binding: String) async throws -> String in
      let service = DCAppAttestService.shared
      guard service.isSupported else { throw KeyException("App Attest is not supported on this phone") }
      guard let hash = fromBase64url(binding) else { throw KeyException("the binding is not base64url") }
      let keyID = try await service.generateKey()
      return base64url(try await service.attestKey(keyID, clientDataHash: hash))
    }

    // Signs message's UTF-8 bytes (ECDSA P-256 over SHA-256, DER), after Face ID or Touch ID; base64url.
    AsyncFunction("sign") { (alias: String, message: String, reason: String) -> String in
      let context = LAContext()
      context.localizedReason = reason
      guard let key = privateKey(alias, context: context) else { throw KeyException("this phone has no approval key") }
      var err: Unmanaged<CFError>?
      guard let sig = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, Data(message.utf8) as CFData, &err) as Data? else {
        throw BiometricException("Face ID or Touch ID did not confirm, so nothing was signed")
      }
      return base64url(sig)
    }

    AsyncFunction("deleteKey") { (alias: String) in
      SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag(alias)] as CFDictionary)
    }
  }
}
