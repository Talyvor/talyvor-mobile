import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono'
import { SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk'
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
          contentStyle: { backgroundColor: c.canvas },
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.ink,
          headerTitleStyle: { fontFamily: fonts.uiMedium },
        }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="agents/[id]" options={{ headerShown: true, title: 'Agent' }} />
          <Stack.Screen name="payees/[id]" options={{ headerShown: true, title: 'Pay' }} />
          <Stack.Screen name="approve/[id]" options={{ headerShown: true, title: 'Approve' }} />
          <Stack.Screen name="approvals/[id]" options={{ headerShown: true, title: 'Approval' }} />
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
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  })
  if (!loaded) return null
  return (
    <SessionProvider>
      <Navigator />
    </SessionProvider>
  )
}
