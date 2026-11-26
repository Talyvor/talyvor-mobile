import { NavigationContext } from 'expo-router/react-navigation'
import { createContext, memo, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import type { AccountType } from '../account'
import { onEffect, openingNow } from '../effects'
import { durations, easings } from '../motion'
import { useSession } from '../session'
import { agentColours, palettes, useTheme } from '../theme'

// B61.71 — Talyvor's own background, drawn once inside Screen so every screen carries it: the logo's payment streams
// flowing into one point, over a matte satin glass of the account's two colours (design/pocket-live/DESIGN.md section
// 6; 6.0 since 26 Nov: the colour fills the whole screen with no fade). Only transforms and opacity move, on the native driver; nothing moves with Reduce Motion on, on a screen that is
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

/** B61.126 — the screen's two colours: an agent's own on its page, otherwise the account's. A sheet's washes read them. */
export function useHues(): Hues {
  return useContext(HuesContext)
}

/** A screen's colours for everything drawn inside it, its sheets included. */
export function ScreenHues({ hues, children }: { hues?: Hues; children: ReactNode }) {
  const account = useContext(HuesContext)
  return <HuesContext.Provider value={hues ?? account}>{children}</HuesContext.Provider>
}

/** Reads the session's account type once per session and hands its colours to every screen's background. Signed out
 * (sign-in, sign-up's first steps) and until the read answers, the background is Personal's. */
export function BackdropHues({ children }: { children: ReactNode }) {
  const { client, signedIn: session, locked, joining } = useSession()
  // B61.27 — nothing of the account, its colours included, is read behind the lock or before sign-up chose it.
  const signedIn = session && !locked && !joining
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

/** A drift back and forth through three keyframes (0, 1, 2 and back), eased in each half, as CSS's `alternate` does.
 * `from` starts it part-way through, as CSS's negative delay does. */
function drift(value: Animated.Value, ms: number, from = 0): Animated.CompositeAnimation {
  const ease = Easing.inOut(Easing.ease)
  const half = ms / 2
  const leg = (toValue: number, duration = half, easing = ease) => Animated.timing(value, { toValue, duration, easing, useNativeDriver: true })
  const stops = [1, 2, 1, 0]
  const loop = Animated.loop(Animated.sequence(stops.map((t) => leg(t))))
  if (!from) return loop
  const i = Math.floor(from / half) % stops.length
  const part = (from % half) / half
  const start = i === 0 ? 0 : stops[i - 1]
  value.setValue(start + (stops[i] - start) * ease(part))
  return Animated.sequence([leg(stops[i], (1 - part) * half, Easing.out(Easing.ease)), ...stops.slice(i + 1).map((t) => leg(t)), loop])
}

/** The keyframes the washes share (pocket-live index.html satin-a, satin-b, satin-c): offsets are a part of the wash's
 * own size. */
const SATIN_A = { x: [0, -0.24, 0.08], y: [0, 0.12, -0.06], scale: [1, 1.18, 0.92], opacity: [1, 0.4, 0.95] } as const
const SATIN_B = { x: [0, 0.2, 0.34], y: [0, 0.14, -0.04], scale: [1.05, 0.9, 1.12], opacity: [0.6, 1, 0.5] } as const
const SATIN_C = { x: [0, 0.24, -0.14], y: [0, -0.12, 0.08], scale: [0.9, 1.16, 1], opacity: [0.25, 1, 0.45] } as const
/** B61.126 — five washes spread from top to bottom (DESIGN.md section 6.0), as parts of their box: the first colour, the
 * second, the mix, the first again and the second again. The fourth and fifth start 6 s and 9 s into their cycles. */
const WASHES = [
  { ...SATIN_A, ms: 15000, from: 0, hue: 0, size: 0.72, left: 0.44, top: -0.08 },
  { ...SATIN_B, ms: 19000, from: 0, hue: 1, size: 0.74, left: -0.12, top: 0.12 },
  { ...SATIN_C, ms: 24000, from: 0, hue: 2, size: 0.7, left: 0.3, top: 0.34 },
  { ...SATIN_B, ms: 21000, from: 6000, hue: 0, size: 0.76, left: -0.14, top: 0.54 },
  { ...SATIN_C, ms: 17000, from: 9000, hue: 1, size: 0.74, left: 0.36, top: 0.7 },
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
 * ink-2 fell to 4.47 to 1 where Business's two washes cross under the sheen; at 32% every line passes. B61.126: light's
 * washes are 46% and its veil 16% (section 6.0). */
const SATIN = {
  light: { wash: 0.46, veil: 0.16, sheen: 0.5, grain: 0.1, streams: 0.5 },
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

/** B61.130 — the streams while every agent is paused: grey, at 70% of their strength. */
const STILL_GREY = '#808694'

/** A clip that opens from the left: what is inside shows from the left edge to `open` (0 to 1) of `width`, on the
 * native driver (the outer box slides in and the inner one slides back by as much). */
function Clip({ open, width, height, children }: { open: Animated.Value; width: number; height: number; children: ReactNode }) {
  return (
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden', transform: [{ translateX: open.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }}>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width, height, transform: [{ translateX: open.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }] }}>{children}</Animated.View>
    </Animated.View>
  )
}

type Lines = { w: number; height: number; fade: readonly (readonly [number, number])[]; paths: string[]; j: number; fx: number; py: number; id: string; colour: string; alpha: number }

/** One group of the streams (every third line from the `j`th), faded down the screen as DESIGN.md's table gives, with
 * the glow at their point on the first group. */
function StreamLines({ w, height, fade, paths, j, fx, py, id, colour, alpha, glow, width }: Lines & { glow?: string; width?: number }) {
  return (
    <Svg width={w} height={height}>
      <Defs>
        <LinearGradient id={`${id}m`} x1="0" y1="0" x2="0" y2="1">
          {fade.map(([o, a]) => (
            <Stop key={o} offset={o} stopColor="#FFFFFF" stopOpacity={a} />
          ))}
        </LinearGradient>
        <Mask id={`${id}k`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={height}>
          <Rect width={w} height={height} fill={`url(#${id}m)`} />
        </Mask>
        <LinearGradient id={`${id}c`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={fx} y2="0">
          <Stop offset="0" stopColor={colour} stopOpacity={0} />
          <Stop offset="0.35" stopColor={colour} stopOpacity={alpha * 0.55} />
          <Stop offset="1" stopColor={colour} stopOpacity={alpha} />
        </LinearGradient>
        {glow ? (
          <RadialGradient id={`${id}g`} gradientUnits="userSpaceOnUse" cx={fx} cy={py} r={90}>
            <Stop offset="0" stopColor={glow} stopOpacity={alpha * 0.5} />
            <Stop offset="1" stopColor={glow} stopOpacity={0} />
          </RadialGradient>
        ) : null}
      </Defs>
      <G mask={`url(#${id}k)`}>
        {paths.map((d, i) => (i % 3 === j ? <Path key={i} d={d} fill="none" stroke={`url(#${id}c)`} strokeWidth={width ?? (j === 0 ? 1.5 : 1)} strokeLinecap="round" /> : null))}
        {glow ? <Rect x={fx - 90} y={py - 90} width={180} height={180} fill={`url(#${id}g)`} /> : null}
      </G>
    </Svg>
  )
}

/** Money moved: one bright band runs along the streams into their point over 760 ms, then the glow at the point swells
 * once (the reference's pulse: `progress` runs to 1.25 of that). */
function Pulse({ progress, ...lines }: Lines & { progress: Animated.Value }) {
  const band = lines.fx * 0.3
  const run = 0.8
  const left = progress.interpolate({ inputRange: [0, run, 1], outputRange: [-band, lines.fx, lines.fx], extrapolate: 'clamp' })
  const back = progress.interpolate({ inputRange: [0, run, 1], outputRange: [band, -lines.fx, -lines.fx], extrapolate: 'clamp' })
  return (
    <View testID="backdrop-pulse" style={StyleSheet.absoluteFill}>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: band, height: lines.height, overflow: 'hidden', transform: [{ translateX: left }] }}>
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: lines.w, height: lines.height, transform: [{ translateX: back }] }}>
          <StreamLines {...lines} width={2.4} />
        </Animated.View>
      </Animated.View>
      {lines.j === 0 ? (
        <Animated.View
          style={{
            position: 'absolute',
            left: lines.fx - 90,
            top: lines.py - 90,
            width: 180,
            height: 180,
            opacity: progress.interpolate({ inputRange: [0, 0.6, 0.8, 1], outputRange: [0, 0, 1, 0] }),
            transform: [{ scale: progress.interpolate({ inputRange: [0, 0.6, 0.8, 1], outputRange: [1, 1, 1.5, 1] }) }],
          }}>
          <Svg width={180} height={180}>
            <Defs>
              <RadialGradient id={`${lines.id}s`} cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={lines.colour} stopOpacity={lines.alpha * 0.5} />
                <Stop offset="1" stopColor={lines.colour} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={180} height={180} fill={`url(#${lines.id}s)`} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  )
}

/**
 * Screen's background. `hues` is an agent's own colour on its page; otherwise the account's. B61.126: the glass fills the
 * screen and stays put; `scrollY` fades only the stream lines, to 40%, and lifts them 24 px over the first 80 px.
 */
export const Backdrop = memo(function Backdrop({ strength, agent, hues, scrollY, still }: { strength: BackdropStrength; agent?: boolean; hues?: Hues; scrollY?: Animated.Value; still?: boolean }) {
  const { c, dark } = useTheme()
  const account = useContext(HuesContext)
  const [h1, h2] = hues ?? account
  const { width: w, height: screenH } = useWindowDimensions()
  const reduce = useReduceMotion()
  const showing = useShowing()
  const moving = showing && reduce === false
  const s = dark ? SATIN.dark : SATIN.light
  const g = screenH
  const geo = STREAMS[strength === 'full' ? (agent ? 'agent' : 'full') : 'calm']
  const id = useId().replace(/[^A-Za-z0-9]/g, '')
  const [seed] = useState(() => Math.random() * 10)
  const paths = useMemo(() => streamPaths(w, geo.height, geo.fy, geo.sp, seed), [w, geo, seed])

  const [washes] = useState(() => WASHES.map(() => new Animated.Value(0)))
  const [sheen] = useState(() => new Animated.Value(0))
  const [sways] = useState(() => SWAYS.map(() => new Animated.Value(0)))
  // B61.130 (DESIGN.md section 15): the streams draw in from the left as the app opens, a pulse runs along them when
  // money moves, and while every agent is paused (or this agent is) they stop and turn grey at 70%.
  const [reveal] = useState(() => new Animated.Value(openingNow() ? 0 : 1))
  const [pulse] = useState(() => new Animated.Value(0))
  const [pulsing, setPulsing] = useState(false)
  const [stillness] = useState(() => new Animated.Value(still ? 1 : 0))
  // The grey streams are drawn while still, and while they fade back to colour on resume.
  const [wasStill, setWasStill] = useState(!!still)
  const [fading, setFading] = useState(false)
  if (wasStill !== !!still) {
    setWasStill(!!still)
    setFading(!still)
  }
  const grey = !!still || (fading && reduce === false)
  const showingNow = useRef(showing)
  useEffect(() => {
    showingNow.current = showing
  })
  useEffect(() => {
    if (reduce === null) return
    const draw = () => {
      if (reduce) return reveal.setValue(1)
      reveal.setValue(0)
      Animated.timing(reveal, { toValue: 1, duration: durations.drawIn, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    }
    if (openingNow()) draw()
    else reveal.setValue(1)
    return onEffect((e) => {
      if (e.kind === 'opening') draw()
      if (e.kind !== 'pulse' || reduce || !showingNow.current) return
      setPulsing(true)
      pulse.setValue(0)
      Animated.timing(pulse, { toValue: 1, duration: durations.pulse * 1.25, easing: (t) => t, useNativeDriver: true }).start(({ finished }) => finished && setPulsing(false))
    })
  }, [reduce, reveal, pulse])
  useEffect(() => {
    if (reduce !== false) return stillness.setValue(still ? 1 : 0)
    const a = Animated.timing(stillness, { toValue: still ? 1 : 0, duration: durations.still, easing: easings.std, useNativeDriver: true })
    a.start(({ finished }) => finished && !still && setFading(false))
    return () => a.stop()
  }, [still, reduce, stillness])
  useEffect(() => {
    if (!moving || still) return
    const all = Animated.parallel(
      sways.map((v, i) => drift(v, SWAYS[i].ms)),
    )
    all.start()
    return () => all.stop()
  }, [moving, still, sways])
  useEffect(() => {
    if (!moving) return
    const all = Animated.parallel([
      ...washes.map((v, i) => drift(v, WASHES[i].ms, WASHES[i].from)),
      Animated.loop(
        Animated.sequence([
          Animated.timing(sheen, { toValue: 1, duration: SHEEN_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(sheen, { toValue: 0, duration: SHEEN_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ),
    ])
    all.start()
    return () => all.stop()
  }, [moving, washes, sheen])

  // The washes' box: 148% of the screen's width, from 24% left of it; 114% of its height, from 8% above it.
  const bw = w * 1.48
  const bh = g * 1.14
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
        opacity: scrollY.interpolate({ inputRange: [0, 80], outputRange: [1, 0.4], extrapolate: 'clamp' }),
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
      style={[styles.fill, { height: g }]}>
      <View testID="backdrop-glass" style={[styles.fill, { height: g, overflow: 'hidden' }]}>
        <View style={{ position: 'absolute', left: -w * 0.24, top: -g * 0.08, width: bw, height: bh }}>
          {WASHES.map((k, i) => {
            const size = bw * k.size
            const colour = k.hue === 0 ? h1 : k.hue === 1 ? h2 : mix(h1, h2)
            const at = (out: readonly number[]) => washes[i].interpolate({ inputRange: [0, 1, 2], outputRange: [...out] })
            return (
              <Animated.View
                key={i}
                testID="backdrop-wash"
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
      </View>
      <Animated.View style={[styles.fill, { height: geo.height }, lift]}>
        <Clip open={reveal} width={w} height={geo.height}>
          {SWAYS.map((sw, j) => {
            const hue = j === 0 ? h1 : h2
            const lines = { w, height: geo.height, fade: geo.fade, paths, j, fx, py }
            return (
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
                <Animated.View style={[StyleSheet.absoluteFill, grey ? { opacity: stillness.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) } : null]}>
                  <StreamLines {...lines} id={`${id}${j}`} colour={hue} alpha={s.streams} glow={j === 0 ? h1 : undefined} />
                </Animated.View>
                {grey ? (
                  <Animated.View testID="backdrop-still" style={[StyleSheet.absoluteFill, { opacity: stillness }]}>
                    <StreamLines {...lines} id={`${id}${j}grey`} colour={STILL_GREY} alpha={s.streams * 0.7} glow={j === 0 ? STILL_GREY : undefined} />
                  </Animated.View>
                ) : null}
                {pulsing ? <Pulse {...lines} id={`${id}${j}pulse`} colour={hue} alpha={Math.min(1, s.streams * 1.9)} progress={pulse} /> : null}
              </Animated.View>
            )
          })}
        </Clip>
      </Animated.View>
    </Animated.View>
  )
})

/** B61.126 — a sheet's ground: the page, solid enough to read a form, with a soft wash of the first colour at 15% from
 * the top right and the second at 13% from the bottom left (DESIGN.md section 6.0). */
export function SheetWash() {
  const { c } = useTheme()
  const [h1, h2] = useHues()
  const id = useId().replace(/[^A-Za-z0-9]/g, '')
  return (
    <View testID="sheet-wash" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={[StyleSheet.absoluteFill, { backgroundColor: c.page }]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={`${id}a`} cx="1" cy="0" rx="1.2" ry="0.7" fx="1" fy="0" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={h1} stopOpacity={0.15} />
            <Stop offset="0.62" stopColor={h1} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}b`} cx="0" cy="1" rx="1.2" ry="0.7" fx="0" fy="1" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={h2} stopOpacity={0.13} />
            <Stop offset="0.62" stopColor={h2} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id}a)`} />
        <Rect width="100%" height="100%" fill={`url(#${id}b)`} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, right: 0, top: 0 },
})
