import { exchangeCodeAsync, makeRedirectUri, useAuthRequest, useAutoDiscovery } from 'expo-auth-session'
import { createBffClient } from '@talyvor/bff-client'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'

import { Door } from '@/components/door'
import { config } from '@/config'
import { useSession } from '@/session'

WebBrowser.maybeCompleteAuthSession()

const redirectUri = makeRedirectUri({ scheme: 'talyvor', path: 'auth' })

/** B61.27 — the front door: the phone number, the code and the passcode (components/door.tsx). While the BFF still
 * offers Google (BFF_GOOGLE_SIGNIN, suite B61.25), "Continue with Google" stays under it for existing accounts, through
 * the identity provider in the phone's own browser with PKCE; with the flag off there is none. */
export default function SignIn() {
  const { signIn } = useSession()
  const discovery = useAutoDiscovery(config.oidcIssuer)
  const [request, , promptAsync] = useAuthRequest(
    { clientId: config.oidcClientId, redirectUri, scopes: ['openid', 'email', 'profile'] },
    discovery,
  )
  const [googleOffered, setGoogleOffered] = useState(false)
  useEffect(() => {
    if (!config.oidcClientId) return
    void createBffClient(config.bffUrl, () => null)
      .authMe()
      .then((me) => setGoogleOffered(me.google_signin !== false), () => setGoogleOffered(true))
  }, [])

  const google = async () => {
    if (!request || !discovery) return
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
      // The door is still there: the number signs in.
    }
  }

  return <Door google={googleOffered && request ? () => void google() : undefined} />
}
