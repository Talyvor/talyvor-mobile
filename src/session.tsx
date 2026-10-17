import { createBffClient, type BffClient, type MobileSession } from '@talyvor/bff-client'
import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { config } from './config'

const KEY = 'talyvor.session'

interface Session {
  /** false until the stored session has been read from the keychain */
  ready: boolean
  signedIn: boolean
  client: BffClient
  /** Trades an ID token for a BFF session and keeps it in the phone's keychain. */
  signIn: (idToken: string) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const client = useMemo(() => createBffClient(config.bffUrl, () => token), [token])

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((stored) => {
        const s = stored ? (JSON.parse(stored) as MobileSession) : null
        if (s && Date.parse(s.expires_at) > Date.now()) setToken(s.token)
      })
      .finally(() => setReady(true))
  }, [])

  const signIn = useCallback(
    async (idToken: string) => {
      const s = await client.signIn(idToken)
      await SecureStore.setItemAsync(KEY, JSON.stringify(s))
      setToken(s.token)
    },
    [client],
  )
  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY)
    setToken(null)
  }, [])

  const value = useMemo(() => ({ ready, signedIn: token !== null, client, signIn, signOut }), [ready, token, client, signIn, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}
