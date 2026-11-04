import { Tabs } from 'expo-router'
import { PlatformPressable } from 'expo-router/build/react-navigation/elements/index'

import { fonts, useTheme } from '@/theme'

export default function TabsLayout() {
  const { c } = useTheme()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.inkMuted,
        tabBarLabelStyle: { fontFamily: fonts.uiMedium, fontSize: 12, marginTop: 0 },
        tabBarItemStyle: { justifyContent: 'center' },
        // Six labels across a 390-wide phone: the tab's own 5-point side padding would cut "Statement" short.
        tabBarButton: ({ style, ...props }) => <PlatformPressable {...props} style={[style, { paddingHorizontal: 0 }]} />,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelPosition: 'below-icon',
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
      <Tabs.Screen name="spending" options={{ title: 'Spending' }} />
      <Tabs.Screen name="statement" options={{ title: 'Statement' }} />
      <Tabs.Screen name="pay" options={{ title: 'Pay' }} />
    </Tabs>
  )
}
