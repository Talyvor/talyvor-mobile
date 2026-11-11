import { BffError } from '@talyvor/bff-client'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type TextStyle } from 'react-native'
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
    <SafeAreaView style={{ flex: 1, backgroundColor: c.page }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.screen}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.ink} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return <Text style={[styles.eyebrow, { color: c.ink3 }]}>{children}</Text>
}

/** A screen's headline, in the display face: one per screen. */
export function Headline({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return (
    <Text accessibilityRole="header" style={[styles.headline, { color: c.ink }]}>
      {children}
    </Text>
  )
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: TextStyle }) {
  const { c } = useTheme()
  return <Text style={[styles.body, { color: muted ? c.ink2 : c.ink }, style]}>{children}</Text>
}

/** A figure that matters: the display face, tabular. */
export function Figure({ children, size = 15, tone }: { children: ReactNode; size?: number; tone?: string }) {
  const { c } = useTheme()
  return <Text style={{ fontFamily: fonts.display, fontSize: size, color: tone ?? c.ink, fontVariant: ['tabular-nums'] }}>{children}</Text>
}

/** Pocket's card: cloud, or white with a shadow where it sits on cloud. */
export function Card({ children, white }: { children: ReactNode; white?: boolean }) {
  const { c } = useTheme()
  return <View style={[styles.card, white ? [{ backgroundColor: c.page }, styles.shadow] : { backgroundColor: c.cloud }]}>{children}</View>
}

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger'

/** 52 tall and round; the primary one is ink and full width. `primary` is today's name for the primary variant. */
export function Button({
  label,
  onPress,
  primary,
  variant = primary ? 'primary' : 'outline',
  disabled,
  hint,
}: {
  label: string
  onPress: () => void
  primary?: boolean
  variant?: ButtonVariant
  disabled?: boolean
  /** why it is disabled, for a screen reader */
  hint?: string
}) {
  const { c } = useTheme()
  const look = {
    primary: { backgroundColor: c.primary, color: c.onPrimary },
    secondary: { backgroundColor: c.cloud2, color: c.ink },
    outline: { borderWidth: 1.5, borderColor: c.control, color: c.ink },
    danger: { borderWidth: 1.5, borderColor: c.danger, color: c.danger },
  }[variant]
  const { color, ...box } = look
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={disabled ? hint : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, box, variant === 'primary' && { alignSelf: 'stretch' }, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  )
}

type ChipTone = 'plain' | 'good' | 'bad' | 'wait' | 'paused'

/** A status in words: green and red are always paired with what they mean. */
export function Chip({ children, tone = 'plain', dot }: { children: ReactNode; tone?: ChipTone; dot?: boolean }) {
  const { c } = useTheme()
  const [backgroundColor, color] = {
    plain: [c.cloud2, c.ink2],
    good: [c.success50, c.success],
    bad: [c.danger50, c.danger],
    wait: [c.tangerine50, c.tangerineInk],
    paused: [c.cloud2, c.ink2],
  }[tone]
  return (
    <View style={[styles.chip, { backgroundColor }]}>
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} /> : null}
      <Text style={[styles.chipText, { color }]}>{children}</Text>
    </View>
  )
}

/** A role switch with its words beside it. */
export function Toggle({ label, value, onValueChange, disabled }: { label: string; value: boolean; onValueChange: (on: boolean) => void; disabled?: boolean }) {
  const { c, dark } = useTheme()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={styles.toggleRow}>
      <Text style={[styles.body, { color: c.ink, flex: 1 }]}>{label}</Text>
      <View style={[styles.toggle, { backgroundColor: value ? c.ink : c.control }]}>
        <View style={[styles.knob, { left: value ? 21 : 3, backgroundColor: value && dark ? '#111216' : '#FFFFFF' }]} />
      </View>
    </Pressable>
  )
}

/** A labelled input. */
export function Field({ label, ...input }: { label: string } & Omit<TextInputProps, 'style'>) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.fieldLabel, { color: c.ink2 }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.ink3}
        style={[styles.input, { backgroundColor: c.page, borderColor: c.control, color: c.ink }]}
        {...input}
      />
    </View>
  )
}

/** A list row: something on the left, a title over a line, something on the right. A rule above every row but the first. */
export function Row({ left, title, sub, right, first, onPress }: { left?: ReactNode; title: string; sub?: string; right?: ReactNode; first?: boolean; onPress?: () => void }) {
  const { c } = useTheme()
  const body = (
    <>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.body, { color: c.ink, fontFamily: fonts.uiMedium }]}>{title}</Text>
        {sub ? <Text style={[styles.sub, { color: c.ink3 }]}>{sub}</Text> : null}
      </View>
      {right}
    </>
  )
  const style = [styles.row, !first && { borderTopWidth: 1, borderTopColor: c.line }]
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={style}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  )
}

/** A budget bar: how much of it is used, 0 to 1, in ink. */
export function Bar({ value, label, thin }: { value: number; label: string; thin?: boolean }) {
  const { c } = useTheme()
  const used = Math.min(1, Math.max(0, value))
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(used * 100) }}
      style={{ height: thin ? 6 : 10, borderRadius: 999, backgroundColor: c.cloud2, overflow: 'hidden' }}>
      <View style={{ width: `${used * 100}%`, height: '100%', borderRadius: 999, backgroundColor: c.ink }} />
    </View>
  )
}

/** The bottom sheet's frame: the tangerine band, the grab handle, rounded at the top. */
export function Sheet({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={[styles.sheet, styles.shadow, { backgroundColor: c.page }]}>
      <View style={[styles.band, { backgroundColor: c.tangerine }]} />
      <View style={[styles.grab, { backgroundColor: c.cloud2 }]} />
      {children}
    </View>
  )
}

/** Loading, a failure in words, or nothing. */
export function LoadState({ loading, error }: { loading: boolean; error: unknown }) {
  const { c } = useTheme()
  if (error) return <Body style={{ color: c.danger }}>Could not load this. Pull down to try again.</Body>
  if (loading) return <ActivityIndicator color={c.ink} style={{ marginVertical: 16 }} />
  return null
}

// pocket.css: .pk.phone .pbody, .eyebrow, .h-page, .card, .btn, .chip, .toggle, .input, .li, .sheet.bottomsheet.
const styles = StyleSheet.create({
  screen: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 40, gap: 14 },
  eyebrow: { fontFamily: fonts.uiMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.48, textTransform: 'uppercase', marginTop: 10 },
  headline: { fontFamily: fonts.display, fontSize: 29, lineHeight: 34, letterSpacing: -0.45 },
  body: { fontFamily: fonts.ui, fontSize: 15, lineHeight: 22 },
  sub: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
  card: { borderRadius: 24, padding: 20, gap: 10 },
  shadow: { boxShadow: '0 1px 2px rgba(17,18,22,0.06), 0 10px 28px rgba(17,18,22,0.07)' },
  button: { height: 52, borderRadius: 999, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: fonts.uiBold, fontSize: 16 },
  chip: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 999 },
  chipText: { fontFamily: fonts.uiMedium, fontSize: 12.5 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  toggle: { width: 44, height: 26, borderRadius: 999 },
  knob: { position: 'absolute', top: 3, width: 20, height: 20, borderRadius: 10 },
  fieldLabel: { fontFamily: fonts.uiMedium, fontSize: 13 },
  input: { height: 46, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, fontFamily: fonts.ui, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 26, paddingHorizontal: 24, paddingBottom: 34, gap: 10, overflow: 'hidden' },
  band: { position: 'absolute', top: 0, left: 0, right: 0, height: 7 },
  grab: { position: 'absolute', top: 12, alignSelf: 'center', width: 40, height: 5, borderRadius: 99 },
})
