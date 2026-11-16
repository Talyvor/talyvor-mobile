import { BffError, createBffClient, type AccountMove, type BffClient, type DoorSession, type MobileSession, type OpenAccountAnswers, type SignupAnswers } from '@talyvor/bff-client'
import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'

import { config } from './config'
import { recheckPhoneKey, unlockWithFaceID } from './keys'
import { endLiveActivities } from './live-activity'
import { clearWidget } from './widget-sync'

const KEY = 'talyvor.session'

/** B61.27 — how long the app may be away before it asks for the passcode again: the BFF's phoneLockAfter (suite B61.25). */
export const LOCK_AFTER_MS = 2 * 60_000

/** The session as the keychain keeps it. B61.27: `person` is a session the door opened, which the BFF locks; `joining`
 * is a sign-up session that has still to choose its account. */
interface Stored extends MobileSession {
  person?: boolean
  joining?: boolean
}

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
  /** B61.27 — a session the door opened (number, code and passcode). `passcode` is a new person's, held in memory only
   * until sign-up's Face ID step has used it. */
  signInWithDoor: (s: DoorSession, passcode?: string) => Promise<void>
  /** B61.27 — the sign-up session chose its account: the session the BFF answered replaces it. */
  finishSignup: (answers: OpenAccountAnswers) => Promise<void>
  /** B61.27 — a Google sign-in took a number and a passcode: from now on it locks like any other. */
  movedFromGoogle: (s: MobileSession) => Promise<void>
  /** B61.27 — the passcode a person just chose, once, for the Face ID step; null once used, or after the app restarted. */
  takeNewPasscode: () => string | null
  /** B61.27 — a session the BFF locks (the door's), so the app asks for the passcode or Face ID. */
  person: boolean
  /** B61.27 — a sign-up session that may only choose its account. */
  joining: boolean
  /** B61.27 — a Google sign-in still to take a number and a passcode. */
  phoneNeeded: boolean
  /** B61.27 — the app is locked: nothing of the account is drawn until the passcode or Face ID opens it. */
  locked: boolean
  /** B61.27 — the app is not in front: the app switcher's picture is the logo. */
  covered: boolean
  unlock: (passcode: string) => Promise<void>
  unlockFaceID: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [person, setPerson] = useState(false)
  const [joining, setJoining] = useState(false)
  const [phoneNeeded, setPhoneNeeded] = useState(false)
  const [locked, setLocked] = useState(false)
  const [covered, setCovered] = useState(false)
  const newPasscode = useRef<string | null>(null)
  // Every 423 is the BFF's lock (suite B61.25): whatever the phone believed, the lock screen shows.
  const client = useMemo(() => createBffClient(config.bffUrl, () => token, ((input, init) => fetch(input, init)) as typeof fetch, () => setLocked(true)), [token])
  const [peg, setPeg] = useState<number | null>(null)
  // Lens's one public rate, the same for every workspace, so a new sign-in need not clear it.
  useEffect(() => {
    if (token && !locked && !joining) void client.peg().then(setPeg)
  }, [client, token, locked, joining])

  const keep = useCallback(async (s: Stored) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(s))
    setPerson(!!s.person)
    setJoining(!!s.joining)
    setToken(s.token)
  }, [])

  // A Google sign-in with no number yet is asked for one (the move, suite B61.25), once the BFF says so.
  const askMove = useCallback(async (t: string) => {
    const me = await createBffClient(config.bffUrl, () => t).authMe().catch(() => null)
    setPhoneNeeded(!!me?.phone_needed)
  }, [])

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then(async (stored) => {
        const s = stored ? (JSON.parse(stored) as Stored) : null
        if (!s || Date.parse(s.expires_at) <= Date.now()) return
        setPerson(!!s.person)
        setJoining(!!s.joining)
        setToken(s.token)
        if (s.person) {
          // Every time the app opens it asks for the passcode or Face ID, and the BFF's lock shuts with it.
          setLocked(true)
          await createBffClient(config.bffUrl, () => s.token).lock('closed').catch(() => undefined)
        } else await askMove(s.token)
      })
      .finally(() => setReady(true))
  }, [askMove])

  // Away: the BFF is told, and after 2 minutes the app asks again. Not in front: the app switcher shows the logo.
  const awayAt = useRef<number | null>(null)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setCovered(state !== 'active')
      if (!token || !person) return
      if (state === 'background' && awayAt.current === null) {
        awayAt.current = Date.now()
        void client.lock('away').catch(() => undefined)
      }
      if (state === 'active') {
        if (awayAt.current !== null && Date.now() - awayAt.current >= LOCK_AFTER_MS) setLocked(true)
        awayAt.current = null
      }
    })
    return () => sub.remove()
  }, [client, token, person])

  const signIn = useCallback(
    async (idToken: string, signup?: SignupAnswers) => {
      const s = await client.signIn(idToken, signup)
      await SecureStore.setItemAsync(KEY, JSON.stringify(s))
      await recheckPhoneKey(createBffClient(config.bffUrl, () => s.token)).catch((err) => console.warn('device: not checked', err))
      await askMove(s.token)
      setPerson(false)
      setJoining(false)
      setLocked(false)
      setToken(s.token)
    },
    [client, askMove],
  )
  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY)
    await clearWidget()
    await endLiveActivities()
    newPasscode.current = null
    setLocked(false)
    setPerson(false)
    setJoining(false)
    setPhoneNeeded(false)
    setToken(null)
  }, [])

  const signInWithDoor = useCallback(
    async (s: DoorSession, passcode?: string) => {
      const joins = !!s.signup_unfinished
      newPasscode.current = joins ? (passcode ?? null) : null
      if (!joins) await recheckPhoneKey(createBffClient(config.bffUrl, () => s.token)).catch((err) => console.warn('device: not checked', err))
      setLocked(false)
      await keep({ token: s.token, expires_at: s.expires_at, person: true, joining: joins })
    },
    [keep],
  )
  const finishSignup = useCallback(
    async (answers: OpenAccountAnswers) => {
      const s = await client.signupAccount(answers)
      await keep({ token: s.token, expires_at: s.expires_at, person: true, joining: false })
    },
    [client, keep],
  )
  const movedFromGoogle = useCallback(
    async (s: MobileSession) => {
      setPhoneNeeded(false)
      await keep({ token: s.token, expires_at: s.expires_at, person: true })
    },
    [keep],
  )
  const takeNewPasscode = useCallback(() => {
    const p = newPasscode.current
    newPasscode.current = null
    return p
  }, [])

  // A lock the BFF no longer knows (the session ended) is a sign-in again.
  const opened = useCallback(
    async (open: () => Promise<void>) => {
      try {
        await open()
        awayAt.current = null
        setLocked(false)
      } catch (err) {
        if (err instanceof BffError && err.status === 401) await signOut()
        throw err
      }
    },
    [signOut],
  )
  const unlock = useCallback((passcode: string) => opened(() => client.unlock({ passcode })), [client, opened])
  const unlockFaceID = useCallback(() => opened(() => unlockWithFaceID(client)), [client, opened])

  // The BFF ended the old token and answered the new one (suite B61.8). The widget and the Live Activities drew the
  // account left behind, so they go with it, as at sign-out.
  const moveTo = useCallback(
    async (m: AccountMove) => {
      if (!m.token) return
      await clearWidget()
      await endLiveActivities()
      await keep({ token: m.token, expires_at: m.expires_at, person })
    },
    [keep, person],
  )
  const switchAccount = useCallback(async (accountID: string) => moveTo(await client.switchAccount(accountID)), [client, moveTo])
  const openAccount = useCallback(async (answers: OpenAccountAnswers) => moveTo(await client.openAccount(answers)), [client, moveTo])

  const value = useMemo(
    () => ({
      ready,
      signedIn: token !== null,
      client,
      peg,
      signIn,
      signOut,
      switchAccount,
      openAccount,
      signInWithDoor,
      finishSignup,
      movedFromGoogle,
      takeNewPasscode,
      person,
      joining,
      phoneNeeded,
      locked,
      covered,
      unlock,
      unlockFaceID,
    }),
    [ready, token, client, peg, signIn, signOut, switchAccount, openAccount, signInWithDoor, finishSignup, movedFromGoogle, takeNewPasscode, person, joining, phoneNeeded, locked, covered, unlock, unlockFaceID],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}
