import { Tabs } from 'expo-router'

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
        tabBarLabelStyle: { fontFamily: fonts.uiMedium, fontSize: 13 },
        tabBarIconStyle: { display: 'none' },
        tabBarLabelPosition: 'beside-icon',
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
      <Tabs.Screen name="statement" options={{ title: 'Statement' }} />
      <Tabs.Screen name="pay" options={{ title: 'Pay' }} />
    </Tabs>
  )
}
