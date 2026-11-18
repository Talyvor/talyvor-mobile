import { Tabs } from 'expo-router'
import { PlatformPressable } from 'expo-router/build/react-navigation/elements/index'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAreas, type Area } from '@/areas'
import { Icon, type IconName } from '@/components/icon'
import { floatingBar, FloatingTabBar, PopIcon, TabMarker } from '@/components/tab-bar'
import { haptic } from '@/motion'
import { useSession } from '@/session'
import { fonts, palettes, useTheme } from '@/theme'
import { useWaiting } from '@/waiting'

// B57.65 — Pocket's tab bar (design/pocket pocket.css, .pk.phone .tabs): each tab's icon over its word, the tab you are
// on in ink with its icon on a tangerine-50 pill, the others ink-3, and Approvals' count of what waits for you.
// B59.3 — a tab in an area the workspace does not have is not there, and a link to it opens Home.
// B61.54 — the launch pack's five (design/launch-pack/design/DESIGN.md, choice 1): Home, Agents, Cards, Pay, Approvals.
// Spending and Statement open from Home and from Activity, and Settings from the top right of Home.
// B61.76 — Pocket Live's bar floats over the content (components/tab-bar.tsx), the tangerine marker slides to the tab you
// are on and its icon pops once.
const TABS: { name: string; title: string; icon: IconName; area?: Area }[] = [
  { name: 'index', title: 'Home', icon: 'home' },
  { name: 'agents', title: 'Agents', icon: 'agents' },
  { name: 'cards', title: 'Cards', icon: 'card' },
  { name: 'pay', title: 'Pay', icon: 'payments' },
  { name: 'approvals', title: 'Approvals', icon: 'approvals' },
  { name: 'chat', title: 'Chat', icon: 'chat', area: 'chat' },
]

export default function TabsLayout() {
  const { c } = useTheme()
  const { client } = useSession()
  const waiting = useWaiting(client)
  const areas = useAreas(client)
  const { bottom } = useSafeAreaInsets()
  if (!areas) return null
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      // B61.73 — a light haptic when the tab changes.
      screenListeners={({ navigation }) => ({ tabPress: () => !navigation.isFocused() && haptic('light') })}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          start: floatingBar.side,
          end: floatingBar.side,
          bottom: floatingBar.above + bottom,
          height: floatingBar.height,
          borderRadius: floatingBar.radius,
          paddingTop: 0,
          paddingBottom: 0,
          backgroundColor: c.page,
          borderWidth: StyleSheet.hairlineWidth,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: c.line,
          boxShadow: '0 10px 30px rgba(17, 18, 22, 0.12)',
        },
        tabBarBackground: () => <TabMarker />,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.ink3,
        tabBarItemStyle: { justifyContent: 'center' },
        // The tab's own 5-point side padding would cut "Approvals" short on a narrow phone. Each tab is the bar's full
        // height, never under the 48 a finger needs.
        tabBarButton: ({ style, ...props }) => <PlatformPressable {...props} style={[style, { paddingHorizontal: 0, minHeight: 48 }]} />,
        tabBarLabelPosition: 'below-icon',
      }}>
      {TABS.map((t) => {
        const badge = t.name === 'approvals' && waiting > 0 ? waiting : 0
        return (
          <Tabs.Protected key={t.name} guard={!t.area || areas.has(t.area)}>
            <Tabs.Screen
              name={t.name}
              options={{
                title: t.title,
                tabBarButtonTestID: `tab-${t.name}`,
                tabBarAccessibilityLabel: badge ? `${t.title}, ${badge} waiting` : t.title,
                tabBarLabel: ({ focused, color }) => (
                  <Text style={{ color, fontFamily: focused ? fonts.uiHeavy : fonts.uiMedium, fontSize: 11, letterSpacing: -0.11, marginTop: 4 }}>{t.title}</Text>
                ),
                tabBarIcon: ({ focused }) => (
                  <View>
                    {/* The tangerine pill under the icon is the bar's marker now, which slides from tab to tab. */}
                    <View style={{ paddingVertical: 2, paddingHorizontal: 10 }}>
                      <PopIcon focused={focused}>
                        <Icon name={t.icon} color={focused ? c.tangerineInk : c.ink3} />
                      </PopIcon>
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
          </Tabs.Protected>
        )
      })}
    </Tabs>
  )
}
