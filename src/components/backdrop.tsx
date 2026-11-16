import { NavigationContext } from 'expo-router/react-navigation'
import { createContext, memo, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import type { AccountType } from '../account'
import { useSession } from '../session'
import { agentColours, palettes, useTheme } from '../theme'

// B61.71 — Talyvor's own background, drawn once inside Screen so every screen carries it: the logo's payment streams
// flowing into one point, over a matte satin glass of the account's two colours (design/pocket-live/DESIGN.md section
// 6). Only transforms and opacity move, on the native driver; nothing moves with Reduce Motion on, on a screen that is
// not showing, or while the app is in the background. It is hidden from screen readers and never takes a touch.

/** Full on Home and an agent's page; Calm on every other screen, behind the status bar and the title only. */
export type BackdropStrength = 'full' | 'calm'
export type Hues = readonly [string, string]

/** The account's two colours: Personal tangerine and cobalt, Business cobalt and mint. */
export const ACCOUNT_HUES: Record<AccountType, Hues> = {
  personal: [palettes.light.tangerine, agentColours.cobalt],
  business: [agentColours.cobalt, agentColours.mint],
}

const HuesContext = createContext<Hues>(ACCOUNT_HUES.personal)

/** Reads the session's account type once per session and hands its colours to every screen's background. Signed out
 * (sign-in, sign-up's first steps) and until the read answers, the background is Personal's. */
export function BackdropHues({ children }: { children: ReactNode }) {
  const { client, signedIn } = useSession()
  // Kept with the session that read it, so a new sign-in or a switched account waits for its own read.
  const [read, setRead] = useState<{ client: typeof client; type: AccountType } | null>(null)
  useEffect(() => {
    if (!signedIn) return
    let live = true
    client.account().then(
      (a) => live && setRead({ client, type: a.account_type }),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [client, signedIn])
  const type = signedIn && read?.client === client ? read.type : null
  return <HuesContext.Provider value={type ? ACCOUNT_HUES[type] : ACCOUNT_HUES.personal}>{children}</HuesContext.Provider>
}

/** The phone's Reduce Motion, read once and on change; null until the first read answers, so nothing starts first. */
function useReduceMotion(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled().then(
      (r) => live && setReduce(r),
      () => live && setReduce(false),
    )
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => {
      live = false
      sub.remove()
    }
  }, [])
  return reduce
}

/** Whether this screen is the one showing: focused in its navigator, and the app in front. Outside a navigator a screen
 * is always the one showing. */
function useShowing(): boolean {
  const navigation = useContext(NavigationContext)
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true)
  const [front, setFront] = useState(AppState.currentState !== 'background')
  useEffect(() => {
    if (!navigation) return
    const on = navigation.addListener('focus', () => setFocused(true))
    const off = navigation.addListener('blur', () => setFocused(false))
    return () => {
      on()
      off()
    }
  }, [navigation])
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setFront(s === 'active'))
    return () => sub.remove()
  }, [])
  return focused && front
}

/** A drift back and forth through three keyframes (0, 1, 2 and back), eased in each half, as CSS's `alternate` does. */
function drift(value: Animated.Value, ms: number): Animated.CompositeAnimation {
  const ease = Easing.inOut(Easing.ease)
  const leg = (toValue: number) => Animated.timing(value, { toValue, duration: ms / 2, easing: ease, useNativeDriver: true })
  return Animated.loop(Animated.sequence([leg(1), leg(2), leg(1), leg(0)]))
}

/** The three washes' keyframes (DESIGN.md: 15, 19 and 24 s): offsets are a part of the wash's own size. */
const WASHES = [
  { ms: 15000, size: 0.7, left: 0.44, top: -0.1, x: [0, -0.24, 0.08], y: [0, 0.12, -0.06], scale: [1, 1.18, 0.92], opacity: [1, 0.4, 0.95] },
  { ms: 19000, size: 0.72, left: -0.1, top: 0.18, x: [0, 0.2, 0.34], y: [0, 0.14, -0.04], scale: [1.05, 0.9, 1.12], opacity: [0.6, 1, 0.5] },
  { ms: 24000, size: 0.66, left: 0.22, top: 0.46, x: [0, 0.24, -0.14], y: [0, -0.12, 0.08], scale: [0.9, 1.16, 1], opacity: [0.25, 1, 0.45] },
] as const
const SHEEN_MS = 13000
/** Each group of streams sways about the point they flow into, so the point stays still. */
const SWAYS = [{ ms: 9000, deg: 1.4 }, { ms: 11000, deg: -1.2 }, { ms: 13000, deg: 1 }] as const

/** The streams' heights and their fades (DESIGN.md's table). */
const STREAMS = {
  full: { height: 330, fy: 0.34, sp: 1.05, fade: [[0, 1], [0.52, 1], [1, 0]] },
  agent: { height: 330, fy: 0.42, sp: 1.05, fade: [[0, 1], [0.52, 1], [1, 0]] },
  calm: { height: 240, fy: 0.3, sp: 0.82, fade: [[0, 1], [0.34, 1], [0.54, 0.26], [0.86, 0], [1, 0]] },
} as const

/** Light and dark (DESIGN.md's satin table). The grain's 38% and 26% are for a soft-light blend, which the phone has
 * not: the alpha tile at a normal blend is matched by eye to index.html, as the table asks. B61.99: the dark washes are
 * 32%, not the table's 34%: measured on the phone's own pixels (scripts/pocket-contrast.mjs), Pay's "Saved payees" in
 * ink-2 fell to 4.47 to 1 where Business's two washes cross under the sheen; at 32% every line passes. */
const SATIN = {
  light: { wash: 0.4, veil: 0.22, sheen: 0.5, grain: 0.1, streams: 0.5 },
  dark: { wash: 0.32, veil: 0.12, sheen: 0.08, grain: 0.08, streams: 0.9 },
} as const

const N = 22

function mix(a: string, b: string): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map((i) => Math.round((ch(a, i) + ch(b, i)) / 2).toString(16).padStart(2, '0')).join('')}`
}

/** The curves at their first frame, as the reference's canvas draws them at its seed. */
export function streamPaths(w: number, h: number, fy: number, sp: number, seed: number): string[] {
  const fx = w * 1.04
  const py = h * fy
  return Array.from({ length: N }, (_, i) => {
    const k = i / (N - 1)
    const y0 = h * (-0.1 + k * sp) + Math.sin(seed * 0.5 + i) * 10
    const c1 = y0 + Math.sin(seed * 0.6 + i * 1.7) * 34
    const c2 = py + (k - 0.5) * 150 + Math.cos(seed * 0.45 + i * 0.9) * 26
    const r = (n: number) => Math.round(n * 10) / 10
    return `M-10 ${r(y0)} C${r(w * 0.3)} ${r(c1)} ${r(w * 0.62)} ${r(c2)} ${r(fx)} ${r(py)}`
  })
}

/**
 * Screen's background. `hues` is an agent's own colour on its page; otherwise the account's.
 * `scrollY` fades it to 45% and lifts it 24 px over the first 80 px of scroll.
 */
export const Backdrop = memo(function Backdrop({ strength, agent, hues, scrollY }: { strength: BackdropStrength; agent?: boolean; hues?: Hues; scrollY?: Animated.Value }) {
  const { c, dark } = useTheme()
  const account = useContext(HuesContext)
  const [h1, h2] = hues ?? account
  const { width: w, height: screenH } = useWindowDimensions()
  const reduce = useReduceMotion()
  const showing = useShowing()
  const moving = showing && reduce === false
  const s = dark ? SATIN.dark : SATIN.light
  const g = Math.round(screenH * 0.7)
  const geo = STREAMS[strength === 'full' ? (agent ? 'agent' : 'full') : 'calm']
  const id = useId().replace(/[^A-Za-z0-9]/g, '')
  const [seed] = useState(() => Math.random() * 10)
  const paths = useMemo(() => streamPaths(w, geo.height, geo.fy, geo.sp, seed), [w, geo, seed])

  const [washes] = useState(() => WASHES.map(() => new Animated.Value(0)))
  const [sheen] = useState(() => new Animated.Value(0))
  const [sways] = useState(() => SWAYS.map(() => new Animated.Value(0)))
  useEffect(() => {
    if (!moving) return
    const all = Animated.parallel([
      ...washes.map((v, i) => drift(v, WASHES[i].ms)),
      Animated.loop(
        Animated.sequence([
          Animated.timing(sheen, { toValue: 1, duration: SHEEN_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(sheen, { toValue: 0, duration: SHEEN_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ),
      ...sways.map((v, i) => drift(v, SWAYS[i].ms)),
    ])
    all.start()
    return () => all.stop()
  }, [moving, washes, sheen, sways])

  // The washes' box: 148% of the screen's width, from 24% left of it; 120% of the glass's height, from 12% above it.
  const bw = w * 1.48
  const bh = g * 1.2
  const sheenW = w * 1.2
  const sheenH = g * 1.8
  // CSS's 105-degree gradient line through the sheen's box.
  const rad = (105 * Math.PI) / 180
  const half = (Math.abs(sheenW * Math.sin(rad)) + Math.abs(sheenH * Math.cos(rad))) / 2
  const [dx, dy] = [Math.sin(rad) * half, -Math.cos(rad) * half]
  const fx = w * 1.04
  const py = geo.height * geo.fy
  const lift = scrollY
    ? {
        opacity: scrollY.interpolate({ inputRange: [0, 80], outputRange: [1, 0.45], extrapolate: 'clamp' }),
        transform: [{ translateY: scrollY.interpolate({ inputRange: [0, 80], outputRange: [0, -24], extrapolate: 'clamp' }) }],
      }
    : null

  return (
    <Animated.View
      testID="backdrop"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[styles.fill, { height: g }, lift]}>
      <View style={[styles.fill, { height: g, overflow: 'hidden' }]}>
        <View style={{ position: 'absolute', left: -w * 0.24, top: -g * 0.12, width: bw, height: bh }}>
          {WASHES.map((k, i) => {
            const size = bw * k.size
            const colour = i === 0 ? h1 : i === 1 ? h2 : mix(h1, h2)
            const at = (out: readonly number[]) => washes[i].interpolate({ inputRange: [0, 1, 2], outputRange: [...out] })
            return (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  left: bw * k.left,
                  top: bh * k.top,
                  width: size,
                  height: size,
                  opacity: at(k.opacity),
                  transform: [{ translateX: at(k.x.map((x) => x * size)) }, { translateY: at(k.y.map((y) => y * size)) }, { scale: at(k.scale) }],
                }}>
                <Svg width={size} height={size}>
                  <Defs>
                    <RadialGradient id={`${id}w${i}`} cx="50%" cy="50%" r="50%">
                      <Stop offset="0" stopColor={colour} stopOpacity={s.wash} />
                      <Stop offset="0.55" stopColor={colour} stopOpacity={s.wash * 0.45} />
                      <Stop offset="1" stopColor={colour} stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id}w${i})`} />
                </Svg>
              </Animated.View>
            )
          })}
        </View>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.page, opacity: s.veil }]} />
        <Animated.View
          style={{
            position: 'absolute',
            left: -w * 0.6,
            top: -g * 0.4,
            width: sheenW,
            height: sheenH,
            transform: [{ translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-0.1 * sheenW, 0.9 * sheenW] }) }],
          }}>
          <Svg width={sheenW} height={sheenH}>
            <Defs>
              <LinearGradient id={`${id}s`} gradientUnits="userSpaceOnUse" x1={sheenW / 2 - dx} y1={sheenH / 2 - dy} x2={sheenW / 2 + dx} y2={sheenH / 2 + dy}>
                <Stop offset="0.32" stopColor="#FFFFFF" stopOpacity={0} />
                <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={s.sheen} />
                <Stop offset="0.68" stopColor="#FFFFFF" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect width={sheenW} height={sheenH} fill={`url(#${id}s)`} />
          </Svg>
        </Animated.View>
        <Image source={require('../../assets/backdrop/satin-grain-alpha.png')} resizeMode="repeat" style={[StyleSheet.absoluteFill, { width: w, height: g, opacity: s.grain }]} />
        {/* The glass fades into the page: full to 52% of its height, 55% by 76%, gone at its foot. */}
        <Svg width={w} height={g} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.page} stopOpacity={0} />
              <Stop offset="0.52" stopColor={c.page} stopOpacity={0} />
              <Stop offset="0.76" stopColor={c.page} stopOpacity={0.45} />
              <Stop offset="1" stopColor={c.page} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width={w} height={g} fill={`url(#${id}f)`} />
        </Svg>
      </View>
      {SWAYS.map((sw, j) => (
        <Animated.View
          key={j}
          testID="backdrop-streams"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: w,
            height: geo.height,
            transformOrigin: [fx, py, 0],
            transform: [{ rotate: sways[j].interpolate({ inputRange: [0, 1, 2], outputRange: ['0deg', `${sw.deg}deg`, `${-sw.deg / 2}deg`] }) }],
          }}>
          <Svg width={w} height={geo.height}>
            <Defs>
              <LinearGradient id={`${id}m${j}`} x1="0" y1="0" x2="0" y2="1">
                {geo.fade.map(([o, a]) => (
                  <Stop key={o} offset={o} stopColor="#FFFFFF" stopOpacity={a} />
                ))}
              </LinearGradient>
              <Mask id={`${id}k${j}`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={geo.height}>
                <Rect width={w} height={geo.height} fill={`url(#${id}m${j})`} />
              </Mask>
              <LinearGradient id={`${id}c${j}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={fx} y2="0">
                <Stop offset="0" stopColor={j === 0 ? h1 : h2} stopOpacity={0} />
                <Stop offset="0.35" stopColor={j === 0 ? h1 : h2} stopOpacity={s.streams * 0.55} />
                <Stop offset="1" stopColor={j === 0 ? h1 : h2} stopOpacity={s.streams} />
              </LinearGradient>
              {j === 0 ? (
                <RadialGradient id={`${id}g`} gradientUnits="userSpaceOnUse" cx={fx} cy={py} r={90}>
                  <Stop offset="0" stopColor={h1} stopOpacity={s.streams * 0.5} />
                  <Stop offset="1" stopColor={h1} stopOpacity={0} />
                </RadialGradient>
              ) : null}
            </Defs>
            <G mask={`url(#${id}k${j})`}>
              {paths.map((d, i) =>
                i % 3 === j ? <Path key={i} d={d} fill="none" stroke={`url(#${id}c${j})`} strokeWidth={j === 0 ? 1.5 : 1} /> : null,
              )}
              {j === 0 ? <Rect x={fx - 90} y={py - 90} width={180} height={180} fill={`url(#${id}g)`} /> : null}
            </G>
          </Svg>
        </Animated.View>
      ))}
    </Animated.View>
  )
})

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, right: 0, top: 0 },
})
