import { useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Text, View, type DimensionValue, type ViewStyle } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'

import { durations, easings, useReduceMotion } from '../motion'
import { fonts, palettes, useTheme } from '../theme'
import { Icon, type IconName } from './icon'

// B61.78 — Pocket Live on the phone (pocket-live DESIGN.md section 5, moves 5 to 8): rows that arrive land, loading
// draws shapes, a confirmation draws its tick, and one line at the top says what happened.

/** One grey shape that shimmers over 1.1 s; still with Reduce Motion. */
function Shape({ height, width = '100%', radius = 14, shimmer }: { height: number; width?: DimensionValue; radius?: number; shimmer: Animated.Value }) {
  const { c } = useTheme()
  return <Animated.View style={{ height, width, borderRadius: radius, backgroundColor: c.cloud2, opacity: shimmer }} />
}

function useShimmer(): Animated.Value {
  const reduce = useReduceMotion()
  const [shimmer] = useState(() => new Animated.Value(1))
  useEffect(() => {
    if (reduce) {
      shimmer.setValue(1)
      return
    }
    const half = durations.shimmer / 2
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 0.45, duration: half, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduce, shimmer])
  return shimmer
}

/** The grey shapes of what is being read: a figure, a strip and a card when `figure`, then rows. Never a spinner, never a
 * figure. A screen reader hears "Reading…" once. */
export function Shapes({ rows = 3, figure = false, testID = 'loading-shapes' }: { rows?: number; figure?: boolean; testID?: string }) {
  const shimmer = useShimmer()
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Reading…" testID={testID} style={{ gap: 14, marginVertical: 6 }}>
      {figure ? (
        <>
          <Shape height={48} width={200} radius={999} shimmer={shimmer} />
          <Shape height={44} width={220} shimmer={shimmer} />
          <Shape height={72} radius={24} shimmer={shimmer} />
        </>
      ) : null}
      {Array.from({ length: rows }, (_, i) =>
        figure ? (
          <Shape key={i} height={58} shimmer={shimmer} />
        ) : (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Shape height={40} width={40} radius={20} shimmer={shimmer} />
            <View style={{ flex: 1, gap: 8 }}>
              <Shape height={14} width="40%" radius={7} shimmer={shimmer} />
              <Shape height={12} width="60%" radius={6} shimmer={shimmer} />
            </View>
            <Shape height={16} width={64} radius={8} shimmer={shimmer} />
          </View>
        ),
      )}
    </View>
  )
}

/** The keys of a list that arrived after it was first read (`ready`), so each lands once. Rows read first never do, nor
 * the rows of a new `scope` (another month, say): they are read first again. */
export function useLanded<K extends string | number>(keys: readonly K[], ready: boolean, scope = ''): (key: K) => boolean {
  const [read, setRead] = useState<{ scope: string; seen: ReadonlySet<K> | null; landed: ReadonlySet<K> }>({ scope, seen: null, landed: new Set() })
  let next = read.scope === scope ? read : { scope, seen: null, landed: new Set<K>() }
  if (ready) {
    const seen = next.seen
    if (seen === null) next = { ...next, seen: new Set(keys) }
    else {
      const fresh = keys.filter((k) => !seen.has(k))
      if (fresh.length) next = { scope, seen: new Set([...seen, ...fresh]), landed: new Set([...next.landed, ...fresh]) }
    }
  }
  if (next !== read) setRead(next)
  return (key) => next.landed.has(key)
}

/** A row that arrived: it drops into its list from above over 420 ms with a tangerine tint that fades over 1.6 s. */
export function Landed({ landed, children }: { landed: boolean; children: ReactNode }) {
  const { c } = useTheme()
  const reduce = useReduceMotion()
  const [drop] = useState(() => new Animated.Value(landed && !reduce ? -14 : 0))
  const [tint] = useState(() => new Animated.Value(landed ? 1 : 0))
  useEffect(() => {
    if (!landed) return
    const anims = [Animated.timing(tint, { toValue: 0, duration: 1600, easing: easings.std, useNativeDriver: true })]
    if (!reduce) anims.push(Animated.timing(drop, { toValue: 0, duration: durations.marker, easing: easings.out, useNativeDriver: true }))
    const all = Animated.parallel(anims)
    all.start()
    return () => all.stop()
  }, [landed, reduce, drop, tint])
  if (!landed) return <>{children}</>
  return (
    <Animated.View testID="landed" style={{ transform: [{ translateY: drop }] }}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: -10, right: -10, borderRadius: 14, backgroundColor: c.tangerine50, opacity: tint }} />
      {children}
    </Animated.View>
  )
}

const AnimatedPath = Animated.createAnimatedComponent(Path)

/** The tick that draws itself after Face ID (the reference's `.tick`): a green circle, the stroke drawn over 420 ms after
 * 260 ms. With Reduce Motion it is drawn at once. */
export function Tick({ size = 84 }: { size?: number }) {
  const { c } = useTheme()
  const reduce = useReduceMotion()
  const [drawn] = useState(() => new Animated.Value(reduce ? 0 : 40))
  useEffect(() => {
    if (reduce) {
      drawn.setValue(0)
      return
    }
    const anim = Animated.timing(drawn, { toValue: 0, duration: durations.marker, delay: 260, easing: easings.out, useNativeDriver: false })
    anim.start()
    return () => anim.stop()
  }, [reduce, drawn])
  const glyph = Math.round(size * 0.48)
  return (
    <View testID="tick" style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: c.success50 }}>
      <Svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
        <AnimatedPath
          d="m6.5 12.5 3.7 3.7 7.3-7.7"
          stroke={c.success}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={40}
          strokeDashoffset={drawn}
        />
      </Svg>
    </View>
  )
}

// The one line at the top of the app (move 8): said once, drawn for 2.3 s by the top-most host. The root layout holds
// one host and a screen drawn in its own window (a Modal) holds another, so the line is always over what is in front.
export const TOP_LINE_MS = 2300
type Line = { text: string; icon: IconName; at: number }
let line: Line | null = null
let hide: ReturnType<typeof setTimeout> | null = null
const hosts: number[] = []
let nextHost = 0
const watchers = new Set<() => void>()
const changed = () => {
  for (const w of watchers) w()
}

/** Says what happened in one short line at the top for 2.3 s, and to a screen reader once. */
export function say(text: string, icon: IconName = 'check') {
  if (hide) clearTimeout(hide)
  line = { text, icon, at: Date.now() }
  changed()
  AccessibilityInfo.announceForAccessibility(text)
  hide = setTimeout(() => {
    line = null
    hide = null
    changed()
  }, TOP_LINE_MS)
}

function watch(w: () => void) {
  watchers.add(w)
  return () => {
    watchers.delete(w)
  }
}

/** Draws the top line while it is said, if this host is the top-most one. */
export function TopLine() {
  const top0 = useContext(SafeAreaInsetsContext)?.top ?? 0
  const reduce = useReduceMotion()
  const [id] = useState(() => nextHost++)
  const said = useSyncExternalStore(watch, () => line)
  const [top, setTop] = useState(false)
  const [rise] = useState(() => new Animated.Value(0))
  useEffect(() => {
    hosts.push(id)
    const w = () => setTop(hosts[hosts.length - 1] === id)
    watchers.add(w)
    changed()
    return () => {
      hosts.splice(hosts.indexOf(id), 1)
      watchers.delete(w)
      changed()
    }
  }, [id])
  useEffect(() => {
    if (!said) return
    rise.setValue(reduce ? 1 : 0)
    if (reduce) return
    const anim = Animated.spring(rise, { toValue: 1, damping: 18, stiffness: 220, useNativeDriver: true })
    anim.start()
    return () => anim.stop()
  }, [said, reduce, rise])
  if (!said || !top) return null
  const style: ViewStyle = {
    position: 'absolute',
    top: top0 + 6,
    alignSelf: 'center',
    maxWidth: 340,
    minHeight: 46,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palettes.light.ink,
    zIndex: 90,
  }
  return (
    <Animated.View
      testID="top-line"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[style, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}>
      <Icon name={said.icon} size={18} color={said.icon === 'x' ? palettes.light.page : palettes.light.tangerine} />
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13.5, lineHeight: 17, color: palettes.light.page, flexShrink: 1 }}>{said.text}</Text>
    </Animated.View>
  )
}

/** For tests: nothing said. */
export function forgetTopLine() {
  if (hide) clearTimeout(hide)
  hide = null
  line = null
  changed()
}
