import { exchangeCodeAsync, makeRedirectUri, useAuthRequest, useAutoDiscovery } from 'expo-auth-session'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { View } from 'react-native'

import { Body, Button, Eyebrow, Headline, Screen } from '@/components/ui'
import { config } from '@/config'
import { useSession } from '@/session'
import { useTheme } from '@/theme'

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

  return (
    <Screen>
      <Image
        source={dark ? require('../../assets/images/talyvor-logo-dark-notag.png') : require('../../assets/images/talyvor-logo-light-notag.png')}
        style={{ width: 180, height: 30, marginTop: 40, marginBottom: 40 }}
        contentFit="contain"
        accessibilityLabel="Talyvor"
      />
      <Eyebrow>Agent wallets</Eyebrow>
      <Headline>Every agent&apos;s money, in your pocket.</Headline>
      <Body muted>Approve what your agents ask for, see what each one holds, and pause one in a tap.</Body>
      <View style={{ marginTop: 24 }}>
        <Button primary label={busy ? 'Signing in…' : 'Sign in'} disabled={busy || !request || !config.oidcClientId} onPress={() => void start()} />
      </View>
      {!config.oidcClientId ? <Body muted>Sign-in is not set up in this build yet.</Body> : null}
      {failure ? <Body style={{ color: c.critical }}>{failure}</Body> : null}
    </Screen>
  )
}
