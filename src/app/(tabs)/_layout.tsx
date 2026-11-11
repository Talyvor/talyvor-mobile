import { Tabs } from 'expo-router'
import { PlatformPressable } from 'expo-router/build/react-navigation/elements/index'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon, type IconName } from '@/components/icon'
import { useSession } from '@/session'
import { fonts, palettes, useTheme } from '@/theme'
import { useWaiting } from '@/waiting'

// B57.65 — Pocket's tab bar (design/pocket pocket.css, .pk.phone .tabs): each tab's icon over its word, the tab you are
// on in ink with its icon on a tangerine-50 pill, the others ink-3, and Approvals' count of what waits for you.
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home' },
  { name: 'chat', title: 'Chat', icon: 'chat' },
  { name: 'approvals', title: 'Approvals', icon: 'approvals' },
  { name: 'spending', title: 'Spending', icon: 'spending' },
  { name: 'statement', title: 'Statement', icon: 'statements' },
  { name: 'pay', title: 'Pay', icon: 'payments' },
]

export default function TabsLayout() {
  const { c } = useTheme()
  const { client } = useSession()
  const waiting = useWaiting(client)
  const { bottom } = useSafeAreaInsets()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // The reference's 84: 8 above, the icon and its word, and the home indicator's space below.
        tabBarStyle: { backgroundColor: c.page, borderTopColor: c.line, height: 58 + bottom, paddingTop: 8, paddingBottom: bottom },
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.ink3,
        tabBarItemStyle: { justifyContent: 'center' },
        // Six labels across a 390-wide phone: the tab's own 5-point side padding would cut "Statement" short.
        tabBarButton: ({ style, ...props }) => <PlatformPressable {...props} style={[style, { paddingHorizontal: 0 }]} />,
        tabBarLabelPosition: 'below-icon',
      }}>
      {TABS.map((t) => {
        const badge = t.name === 'approvals' && waiting > 0 ? waiting : 0
        return (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarAccessibilityLabel: badge ? `${t.title}, ${badge} waiting` : t.title,
              tabBarLabel: ({ focused, color }) => (
                <Text style={{ color, fontFamily: focused ? fonts.uiHeavy : fonts.uiMedium, fontSize: 11, letterSpacing: -0.11, marginTop: 4 }}>{t.title}</Text>
              ),
              tabBarIcon: ({ focused }) => (
                <View>
                  <View style={{ paddingVertical: 2, paddingHorizontal: 10, borderRadius: 999, backgroundColor: focused ? c.tangerine50 : 'transparent' }}>
                    <Icon name={t.icon} color={focused ? c.tangerineInk : c.ink3} />
                  </View>
                  {badge ? (
                    <View testID="approvals-badge" style={{ position: 'absolute', top: -4, left: 26, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 999, backgroundColor: c.tangerine, alignItems: 'center', justifyContent: 'center' }}>
                      {/* Ink on tangerine in both themes, as the reference draws it. */}
                      <Text style={{ color: palettes.light.ink, fontFamily: fonts.uiBold, fontSize: 11, lineHeight: 18 }}>{badge}</Text>
                    </View>
                  ) : null}
                </View>
              ),
            }}
          />
        )
      })}
    </Tabs>
  )
}
