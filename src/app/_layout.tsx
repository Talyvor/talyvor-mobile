import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque'
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold } from '@expo-google-fonts/figtree'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'

import { useHideFromAppSwitcher } from '@/app-switcher'
import { BackdropHues } from '@/components/backdrop'
import { Door } from '@/components/door'
import { forgetTopLine, TopLine } from '@/components/live'
import { Cover, LockScreen } from '@/components/lock-screen'
import { useLiveActivities } from '@/live-activity'
import { usePushApprovals } from '@/push'
import { SessionProvider, useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

function Navigator() {
  const { ready, signedIn, client, locked, joining, phoneNeeded, covered } = useSession()
  const { c, dark } = useTheme()
  // B61.27 — nothing reads the account while the app is locked or a sign-up has still to choose its account.
  const open = ready && signedIn && !locked && !joining
  usePushApprovals(client, open)
  useLiveActivities(client, open)
  useHideFromAppSwitcher(ready && signedIn)
  // B61.78 — a line said at the top is forgotten when the app is covered, so the app switcher never shows it.
  useEffect(() => {
    if (covered) forgetTopLine()
  }, [covered])
  if (!ready) return null
  // B61.27 — the lock is drawn instead of the app, so nothing of the account is behind it.
  if (signedIn && locked)
    return (
      <>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <LockScreen />
        {covered ? <Cover /> : null}
      </>
    )
  // B61.27 — a Google sign-in takes a number and a passcode before anything else (the move, suite B61.25).
  if (signedIn && phoneNeeded && !joining)
    return (
      <>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Door move />
        {covered ? <Cover /> : null}
      </>
    )
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.page },
          headerStyle: { backgroundColor: c.page },
          headerShadowVisible: false,
          headerTintColor: c.ink,
          headerTitleStyle: { fontFamily: fonts.uiBold },
        }}>
        <Stack.Protected guard={signedIn && !joining}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="agents/[id]" />
          <Stack.Screen name="agents/new" />
          <Stack.Screen name="payees/[id]" />
          <Stack.Screen name="pay-person" />
          <Stack.Screen name="instant-transfer/index" />
          <Stack.Screen name="instant-transfer/[id]" />
          <Stack.Screen name="approve/[id]" options={{ headerShown: true, title: 'Approve' }} />
          <Stack.Screen name="approvals/[id]" />
          <Stack.Screen name="notices/[id]" />
          <Stack.Screen name="bills" />
          <Stack.Screen name="disputes" />
          <Stack.Screen name="pause-all" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="help" />
          <Stack.Screen name="activity" />
          <Stack.Screen name="spending" />
          <Stack.Screen name="statement" />
          <Stack.Screen name="widget" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        {/* B59.9 — open either way: steps 1 and 2 come before the session, step 3 after it. */}
        <Stack.Screen name="sign-up" />
      </Stack>
      {/* B61.78 — one line at the top of the app for 2.3 s, saying what happened; never over the app switcher's cover. */}
      {covered ? null : <TopLine />}
      {/* B61.27 — not in front, the app switcher's picture is the mark, never the screen. */}
      {signedIn && covered ? <Cover /> : null}
    </>
  )
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
  })
  if (!loaded) return null
  return (
    <SessionProvider>
      <BackdropHues>
        <Navigator />
      </BackdropHues>
    </SessionProvider>
  )
}
