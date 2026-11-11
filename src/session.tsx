import { createBffClient, type BffClient, type MobileSession, type SignupAnswers } from '@talyvor/bff-client'
import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { config } from './config'
import { recheckPhoneKey } from './keys'
import { endLiveActivities } from './live-activity'
import { clearWidget } from './widget-sync'

const KEY = 'talyvor.session'

interface Session {
  /** false until the stored session has been read from the keychain */
  ready: boolean
  signedIn: boolean
  client: BffClient
  /** USD per LXC once read, for formatLXC; null until then, or while Lens does not supply it. */
  peg: number | null
  /** Trades an ID token for a BFF session and keeps it in the phone's keychain; sign-up sends its answers with it. */
  signIn: (idToken: string, signup?: SignupAnswers) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const client = useMemo(() => createBffClient(config.bffUrl, () => token), [token])
  const [peg, setPeg] = useState<number | null>(null)
  // Lens's one public rate, the same for every workspace, so a new sign-in need not clear it.
  useEffect(() => {
    if (token) void client.peg().then(setPeg)
  }, [client, token])

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((stored) => {
        const s = stored ? (JSON.parse(stored) as MobileSession) : null
        if (s && Date.parse(s.expires_at) > Date.now()) setToken(s.token)
      })
      .finally(() => setReady(true))
  }, [])

  const signIn = useCallback(
    async (idToken: string, signup?: SignupAnswers) => {
      const s = await client.signIn(idToken, signup)
      await SecureStore.setItemAsync(KEY, JSON.stringify(s))
      await recheckPhoneKey(createBffClient(config.bffUrl, () => s.token)).catch((err) => console.warn('device: not checked', err))
      setToken(s.token)
    },
    [client],
  )
  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY)
    await clearWidget()
    await endLiveActivities()
    setToken(null)
  }, [])

  const value = useMemo(() => ({ ready, signedIn: token !== null, client, peg, signIn, signOut }), [ready, token, client, peg, signIn, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}
