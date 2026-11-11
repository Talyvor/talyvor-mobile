import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque'
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { useHideFromAppSwitcher } from '@/app-switcher'
import { useLiveActivities } from '@/live-activity'
import { usePushApprovals } from '@/push'
import { SessionProvider, useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

function Navigator() {
  const { ready, signedIn, client } = useSession()
  const { c, dark } = useTheme()
  usePushApprovals(client, ready && signedIn)
  useLiveActivities(client, ready && signedIn)
  useHideFromAppSwitcher(ready && signedIn)
  if (!ready) return null
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
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="agents/[id]" options={{ headerShown: true, title: 'Agent' }} />
          <Stack.Screen name="payees/[id]" options={{ headerShown: true, title: 'Pay' }} />
          <Stack.Screen name="approve/[id]" options={{ headerShown: true, title: 'Approve' }} />
          <Stack.Screen name="approvals/[id]" options={{ headerShown: true, title: 'Approval' }} />
          <Stack.Screen name="notices/[id]" options={{ headerShown: true, title: 'Payment' }} />
          <Stack.Screen name="bills" options={{ headerShown: true, title: 'Bills due' }} />
          <Stack.Screen name="pause-all" options={{ headerShown: true, title: 'Pause agents' }} />
          <Stack.Screen name="widget" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  )
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
  })
  if (!loaded) return null
  return (
    <SessionProvider>
      <Navigator />
    </SessionProvider>
  )
}
