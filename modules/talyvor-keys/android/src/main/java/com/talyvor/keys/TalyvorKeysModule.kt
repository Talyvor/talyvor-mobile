package com.talyvor.keys

import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

// B40.13 — the approval key: P-256 in StrongBox (or the TEE where a phone has no StrongBox), usable only after a strong
// biometric, once per signature, through a BiometricPrompt CryptoObject. Lens gets the public key as SubjectPublicKeyInfo
// DER and the key's own attestation chain, whose challenge was fixed when the key was made.

class KeyException(message: String) : CodedException("ERR_TALYVOR_KEY", message, null)

class BiometricException(message: String) : CodedException("ERR_BIOMETRIC", message, null)

private fun base64url(b: ByteArray) = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

private fun fromBase64url(s: String) = Base64.decode(s, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

private fun alias(name: String) = "com.talyvor.keys.$name"

class TalyvorKeysModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TalyvorKeys")

    Function("isAvailable") {
      BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
    }

    // Makes the key, replacing any earlier one under name, and answers its public key, base64url SPKI DER.
    AsyncFunction("createKey") { name: String, attestationChallenge: String ->
      keyStore().deleteEntry(alias(name))
      val strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
      val pair = try {
        generate(name, fromBase64url(attestationChallenge), strongBox)
      } catch (e: StrongBoxUnavailableException) {
        generate(name, fromBase64url(attestationChallenge), false)
      }
      base64url(pair.public.encoded)
    }

    // The key's attestation certificates, leaf first, as concatenated DER, base64url. The binding was fixed at createKey.
    AsyncFunction("attest") { name: String, _: String ->
      val chain = keyStore().getCertificateChain(alias(name)) ?: throw KeyException("this phone has no approval key")
      base64url(chain.fold(ByteArray(0)) { acc, c -> acc + c.encoded })
    }

    // Signs message's UTF-8 bytes (SHA256withECDSA, DER) after a strong biometric; base64url.
    AsyncFunction("sign") Coroutine { name: String, message: String, reason: String ->
      val key = keyStore().getKey(alias(name), null) as? PrivateKey ?: throw KeyException("this phone has no approval key")
      val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(key) }
      val unlocked = withContext(Dispatchers.Main.immediate) { authenticate(signature, reason) }
      base64url(unlocked.run { update(message.toByteArray(Charsets.UTF_8)); sign() })
    }

    AsyncFunction("deleteKey") { name: String ->
      keyStore().deleteEntry(alias(name))
    }
  }

  private fun generate(name: String, challenge: ByteArray, strongBox: Boolean) =
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
      val spec = KeyGenParameterSpec.Builder(alias(name), KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(true)
        .setInvalidatedByBiometricEnrollment(true)
        .setAttestationChallenge(challenge)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // 0: every use needs its own biometric, through the CryptoObject.
        spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      }
      if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) spec.setIsStrongBoxBacked(true)
      initialize(spec.build())
    }.generateKeyPair()

  private suspend fun authenticate(signature: Signature, reason: String): Signature {
    val activity = appContext.currentActivity as? FragmentActivity
      ?: throw BiometricException("the app is not in the foreground, so nothing was signed")
    return suspendCoroutine { cont ->
      val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          val s = result.cryptoObject?.signature
          if (s == null) cont.resumeWithException(BiometricException("the fingerprint check gave back no key, so nothing was signed"))
          else cont.resume(s)
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          cont.resumeWithException(BiometricException("the fingerprint or face check did not confirm ($errString), so nothing was signed"))
        }
      })
      val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle(reason)
        .setNegativeButtonText(activity.getString(android.R.string.cancel))
        .setAllowedAuthenticators(BIOMETRIC_STRONG)
        .build()
      prompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
    }
  }
}
