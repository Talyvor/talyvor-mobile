import { exchangeCodeAsync, makeRedirectUri, useAuthRequest, useAutoDiscovery } from 'expo-auth-session'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { Body, Button, Headline, Screen } from '@/components/ui'
import { config } from '@/config'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

WebBrowser.maybeCompleteAuthSession()

const redirectUri = makeRedirectUri({ scheme: 'talyvor', path: 'auth' })

/** Sign-in through the identity provider in the phone's own browser, with PKCE; the BFF then opens a session. */
export default function SignIn() {
  const { signIn } = useSession()
  const { c, dark } = useTheme()
  const discovery = useAutoDiscovery(config.oidcIssuer)
  const [request, , promptAsync] = useAuthRequest(
    { clientId: config.oidcClientId, redirectUri, scopes: ['openid', 'email', 'profile'] },
    discovery,
  )
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const start = async () => {
    if (!request || !discovery) return
    setBusy(true)
    setFailure('')
    try {
      const result = await promptAsync()
      if (result.type !== 'success') return
      const tokens = await exchangeCodeAsync(
        { clientId: config.oidcClientId, code: result.params.code, redirectUri, extraParams: { code_verifier: request.codeVerifier ?? '' } },
        discovery,
      )
      if (!tokens.idToken) throw new Error('no ID token')
      await signIn(tokens.idToken)
    } catch {
      setFailure('Sign-in did not finish. You can try again.')
    } finally {
      setBusy(false)
    }
  }

  // B57.78 — Pocket's p-signin: the logo, the headline and its line, Sign in at full width, and which account to use.
  return (
    <Screen>
      <Image
        source={dark ? require('../../assets/logo/talyvor-logo-small-on-dark-480.png') : require('../../assets/logo/talyvor-logo-small-on-light-480.png')}
        style={{ width: 150, height: 48, marginTop: 74 }}
        contentFit="contain"
        accessibilityLabel="Talyvor"
      />
      <View style={{ marginTop: 8 }}>
        <Headline>Every agent’s money, in your pocket.</Headline>
      </View>
      <Body muted>Approve what your agents ask for, see what each one holds, and pause one in a tap.</Body>
      <View style={{ marginTop: 8 }}>
        <Button primary label={busy ? 'Signing in…' : 'Sign in'} disabled={busy || !request || !config.oidcClientId} onPress={() => void start()} />
      </View>
      <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>Use the same account you signed up with on the web.</Text>
      {/* B59.9 — a new person opens an account here, with the web's link words. */}
      <Button variant="secondary" label="Create a workspace" disabled={busy} onPress={() => router.push('/sign-up')} />
      {!config.oidcClientId ? <Body muted>Sign-in is not set up in this build yet.</Body> : null}
      {failure ? <Body style={{ color: c.critical }}>{failure}</Body> : null}
    </Screen>
  )
}
