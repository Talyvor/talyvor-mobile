import { createBffClient, type AccountMove, type BffClient, type MobileSession, type OpenAccountAnswers, type SignupAnswers } from '@talyvor/bff-client'
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
  /** B61.10 — moves the session to another of the person's accounts; every screen then reads that account. */
  switchAccount: (accountID: string) => Promise<void>
  /** B61.10 — opens another account with sign-up's answers and moves the session to it. */
  openAccount: (answers: OpenAccountAnswers) => Promise<void>
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

  // The BFF ended the old token and answered the new one (suite B61.8). The widget and the Live Activities drew the
  // account left behind, so they go with it, as at sign-out.
  const moveTo = useCallback(async (m: AccountMove) => {
    if (!m.token) return
    await SecureStore.setItemAsync(KEY, JSON.stringify({ token: m.token, expires_at: m.expires_at } satisfies MobileSession))
    await clearWidget()
    await endLiveActivities()
    setToken(m.token)
  }, [])
  const switchAccount = useCallback(async (accountID: string) => moveTo(await client.switchAccount(accountID)), [client, moveTo])
  const openAccount = useCallback(async (answers: OpenAccountAnswers) => moveTo(await client.openAccount(answers)), [client, moveTo])

  const value = useMemo(
    () => ({ ready, signedIn: token !== null, client, peg, signIn, signOut, switchAccount, openAccount }),
    [ready, token, client, peg, signIn, signOut, switchAccount, openAccount],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}
