import { BffError } from '@talyvor/bff-client'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useSession } from '../session'
import { fonts, useTheme } from '../theme'

/** Loads once and on reload (pull-to-refresh, or after a change); a 401 means the session ended, so it signs out. */
export function useLoad<T>(load: () => Promise<T>) {
  const { signOut } = useSession()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    load()
      .then(
        (d) => live && (setData(d), setError(null)),
        (err) => {
          if (!live) return
          setError(err)
          if (err instanceof BffError && err.status === 401) void signOut()
        },
      )
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [load, signOut, round])
  const reload = useCallback(() => {
    setLoading(true)
    setRound((r) => r + 1)
  }, [])
  return { data, error, loading, reload }
}

export function Screen({ children, onRefresh, refreshing = false }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  const { c } = useTheme()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.screen}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return <Text style={[styles.eyebrow, { color: c.label }]}>{children}</Text>
}

/** A headline with the teal rule under it: one per section. */
export function Headline({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={{ marginBottom: 20 }}>
      <Text accessibilityRole="header" style={[styles.headline, { color: c.ink }]}>
        {children}
      </Text>
      <View style={{ width: 32, height: 2, backgroundColor: c.accent, marginTop: 10 }} />
    </View>
  )
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: TextStyle }) {
  const { c } = useTheme()
  return <Text style={[styles.body, { color: muted ? c.inkMuted : c.ink }, style]}>{children}</Text>
}

/** A figure that matters: IBM Plex Mono, tabular. */
export function Figure({ children, size = 15, tone }: { children: ReactNode; size?: number; tone?: string }) {
  const { c } = useTheme()
  return (
    <Text style={{ fontFamily: fonts.monoMedium, fontSize: size, color: tone ?? c.ink, fontVariant: ['tabular-nums'] }}>{children}</Text>
  )
}

export function Card({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return <View style={[styles.card, { backgroundColor: c.raised, borderColor: c.line }]}>{children}</View>
}

export function Button({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: c.accent, borderColor: c.accent } : { borderColor: c.lineStrong },
        (pressed || disabled) && { opacity: 0.7 },
      ]}>
      <Text style={[styles.buttonText, { color: primary ? c.onAccent : c.ink }]}>{label}</Text>
    </Pressable>
  )
}

/** Loading, a failure in words, or nothing. */
export function LoadState({ loading, error }: { loading: boolean; error: unknown }) {
  const { c } = useTheme()
  if (error) return <Body style={{ color: c.critical }}>Could not load this. Pull down to try again.</Body>
  if (loading) return <ActivityIndicator color={c.accent} style={{ marginVertical: 16 }} />
  return null
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 40, gap: 12 },
  eyebrow: { fontFamily: fonts.uiMedium, fontSize: 12, letterSpacing: 2.6, textTransform: 'uppercase', marginTop: 12 },
  headline: { fontFamily: fonts.uiMedium, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  body: { fontFamily: fonts.ui, fontSize: 15, lineHeight: 24 },
  card: { borderWidth: 1, borderRadius: 10, padding: 16, gap: 8 },
  button: { borderWidth: 1, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 18, alignItems: 'center' },
  buttonText: { fontFamily: fonts.uiBold, fontSize: 14 },
})
