import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { onEffect, openingNow } from '../effects'
import { durations, easings, useReduceMotion } from '../motion'
import { agentColours, palettes, useTheme } from '../theme'
import { useHues } from './backdrop'

// B61.130 — section 15's special effects on the phone (pocket-live DESIGN.md): the ring and the burst over the app, the
// ripple, the tick, the ring on round actions, the breathing waiting row, the band of light and the frost on a card, and
// Home's blocks rising as the app opens. Only transforms and opacity move, on the native driver. With Reduce Motion on
// none of them starts: the ring, the burst, the ripple, the band and the round ring are not drawn at all, and the tick,
// the frost and the risen blocks are drawn as they end.

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/** A clip that opens from the left: what is inside shows from its left edge to `open` (0 to 1) of `width`, on the
 * native driver (the outer box slides in, the inner one slides back by as much). */
function Reveal({ open, width, children }: { open: Animated.Value; width: number; children: ReactNode }) {
  const shift = open.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] })
  const back = open.interpolate({ inputRange: [0, 1], outputRange: [width, 0] })
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden', transform: [{ translateX: shift }] }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: back }] }]}>{children}</Animated.View>
    </Animated.View>
  )
}

// ——— the ring and the burst, over the whole app ———

/** The ring's gradient is drawn this size and scaled: it is soft, so it reads the same as one drawn full size. */
const RING_DRAWN = 200

type Ring = { id: number; colour: string; v: Animated.Value }
type Burst = { id: number; v: Animated.Value; bits: Bit[] }
type Bit = { colour: string; long: boolean; r: number; x: number[]; y: number[]; rot: string[] }

/** The burst's 44 dots and dashes from (x, y): each thrown out and falling, as the reference's canvas steps them at 60
 * frames a second, sampled every fifth frame for the native driver. */
export function burstBits(x: number, y: number, colours: readonly string[], random: () => number = Math.random): Bit[] {
  const frames = Math.round((durations.burst / 1000) * 60)
  return Array.from({ length: 44 }, (_, i) => {
    const a = random() * Math.PI * 2
    const speed = 2.5 + random() * 6.5
    let [px, py, vx, vy, rot] = [x, y, Math.cos(a) * speed, Math.sin(a) * speed - 3.2, a]
    const xs: number[] = []
    const ys: number[] = []
    const rots: string[] = []
    for (let f = 0; f <= frames; f++) {
      if (f % 5 === 0 || f === frames) {
        xs.push(px)
        ys.push(py)
        rots.push(`${rot}rad`)
      }
      px += vx
      py += vy
      vy += 0.22
      vx *= 0.985
      rot += 0.12
    }
    return { colour: colours[i % colours.length], long: i % 3 === 0, r: 2 + random() * 3.5, x: xs, y: ys, rot: rots }
  })
}

/** Drawn once at the top of the app: the ring when money moves and the burst when an account opens or an agent is
 * made. Hidden from screen readers and never takes a touch. */
export function EffectsLayer() {
  const { c } = useTheme()
  const [h1, h2] = useHues()
  const { width: w, height: h } = useWindowDimensions()
  const reduce = useReduceMotion()
  const [rings, setRings] = useState<Ring[]>([])
  const [bursts, setBursts] = useState<Burst[]>([])
  const next = useRef(0)
  const now = useRef({ reduce, good: c.success, h1, h2, w, h })
  useEffect(() => {
    now.current = { reduce, good: c.success, h1, h2, w, h }
  })

  useEffect(
    () =>
      onEffect((e) => {
        const at = now.current
        if (at.reduce) return
        const id = ++next.current
        const v = new Animated.Value(0)
        if (e.kind === 'ring') {
          setRings((r) => [...r, { id, v, colour: e.tone === 'good' ? at.good : at.h1 }])
          Animated.timing(v, { toValue: 1, duration: durations.ring, easing: easings.out, useNativeDriver: true }).start(() => setRings((r) => r.filter((x) => x.id !== id)))
        } else if (e.kind === 'burst') {
          const bits = burstBits(at.w / 2, at.h * 0.36, [at.h1, at.h2, palettes.light.tangerine, agentColours.lemon])
          setBursts((b) => [...b, { id, v, bits }])
          Animated.timing(v, { toValue: 1, duration: durations.burst, easing: (t) => t, useNativeDriver: true }).start(() => setBursts((b) => b.filter((x) => x.id !== id)))
        }
      }),
    [],
  )

  if (!rings.length && !bursts.length) return null
  const d = Math.hypot(w, h) * 2.1
  return (
    <View testID="effects-layer" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={StyleSheet.absoluteFill}>
      {rings.map((r) => (
        <Animated.View
          key={r.id}
          testID="effect-ring"
          style={{
            position: 'absolute',
            left: w / 2 - RING_DRAWN / 2,
            top: h / 2 - RING_DRAWN / 2,
            width: RING_DRAWN,
            height: RING_DRAWN,
            opacity: r.v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: r.v.interpolate({ inputRange: [0, 1], outputRange: [(0.02 * d) / RING_DRAWN, d / RING_DRAWN] }) }],
          }}>
          <Svg width={RING_DRAWN} height={RING_DRAWN}>
            <Defs>
              <RadialGradient id={`ring${r.id}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0.52" stopColor={r.colour} stopOpacity={0} />
                <Stop offset="0.78" stopColor={r.colour} stopOpacity={0.46} />
                <Stop offset="1" stopColor={r.colour} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={RING_DRAWN} height={RING_DRAWN} fill={`url(#ring${r.id})`} />
          </Svg>
        </Animated.View>
      ))}
      {bursts.map((b) => {
        const steps = b.bits[0].x.map((_, i, all) => i / (all.length - 1))
        const fade = b.v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.75, 0] })
        return (
          <View key={b.id} testID="effect-burst" style={StyleSheet.absoluteFill}>
            {b.bits.map((bit, i) => {
              const bw = bit.long ? bit.r * 4 : bit.r * 2
              const bh = bit.long ? bit.r : bit.r * 2
              return (
                <Animated.View
                  key={i}
                  style={{
                    position: 'absolute',
                    left: -bw / 2,
                    top: -bh / 2,
                    width: bw,
                    height: bh,
                    borderRadius: bh / 2,
                    backgroundColor: bit.colour,
                    opacity: fade,
                    transform: [
                      { translateX: b.v.interpolate({ inputRange: steps, outputRange: bit.x }) },
                      { translateY: b.v.interpolate({ inputRange: steps, outputRange: bit.y }) },
                      { rotate: b.v.interpolate({ inputRange: steps, outputRange: bit.rot }) },
                    ],
                  }}
                />
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

// ——— the ripple ———

/** A ripple's colour: on a main button a tint of its words; on grey buttons, keys, round actions and choices a tint of
 * ink; on the waiting row tangerine. */
export type RippleTone = 'onPrimary' | 'ink' | 'tangerine'

type Drop = { id: number; x: number; y: number; d: number; v: Animated.Value }

/** A ripple that opens from where the finger lands: `start` from a press-in, `layer` drawn inside the control. */
export function useRipple(tone: RippleTone | undefined, radius: number) {
  const { c } = useTheme()
  const reduce = useReduceMotion()
  const size = useRef({ w: 0, h: 0 })
  const [drops, setDrops] = useState<Drop[]>([])
  const next = useRef(0)
  const start = useCallback(
    (e: GestureResponderEvent) => {
      if (!tone || reduce) return
      const { w, h } = size.current
      const d = Math.max(w, h, 1) * 2.2
      const id = ++next.current
      const v = new Animated.Value(0)
      setDrops((all) => [...all, { id, x: e.nativeEvent.locationX ?? w / 2, y: e.nativeEvent.locationY ?? h / 2, d, v }])
      Animated.timing(v, { toValue: 1, duration: durations.ripple, easing: easings.out, useNativeDriver: true }).start(() => setDrops((all) => all.filter((x) => x.id !== id)))
    },
    [tone, reduce],
  )
  const colour = tone === 'onPrimary' ? `${c.onPrimary}57` : tone === 'tangerine' ? `${c.tangerine}4D` : `${c.ink}24`
  const layer = drops.length ? (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      {drops.map((p) => (
        <Animated.View
          key={p.id}
          testID="ripple"
          style={{
            position: 'absolute',
            left: p.x - p.d / 2,
            top: p.y - p.d / 2,
            width: p.d,
            height: p.d,
            borderRadius: p.d / 2,
            backgroundColor: colour,
            opacity: p.v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: p.v.interpolate({ inputRange: [0, 1], outputRange: [0.05, 1] }) }],
          }}
        />
      ))}
    </View>
  ) : null
  const onLayout = useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }
  }, [])
  return { start, layer, onLayout }
}

// ——— the tick ———

/** A small job's button: once the server has answered, `tick()` turns it green with a tick for 430 ms; the caller then
 * closes its sheet. The request is sent on the press, before any of this; the tick only follows the answer. */
export function useTick() {
  const [ticked, setTicked] = useState(false)
  const tick = useCallback(async () => {
    setTicked(true)
    await wait(durations.tick)
  }, [])
  return { ticked, tick }
}

/** The tick drawn in a button that has done its job: it draws itself from the left, or stands drawn with Reduce Motion. */
export function DoneTick({ colour }: { colour: string }) {
  const reduce = useReduceMotion()
  const [open] = useState(() => new Animated.Value(reduce ? 1 : 0))
  useEffect(() => {
    if (reduce) return open.setValue(1)
    const a = Animated.timing(open, { toValue: 1, duration: 300, delay: 40, easing: easings.out, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [open, reduce])
  return (
    <View testID="done-tick" style={{ width: 26, height: 26 }}>
      <Reveal open={open} width={26}>
        <Svg width={26} height={26} viewBox="0 0 24 24">
          <Path d="m5.5 12.5 4.2 4.2 8.8-9.2" fill="none" stroke={colour} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Reveal>
    </View>
  )
}

// ——— round actions, the waiting row ———

/** A ring that opens around a round quick action as the finger lifts: give it a new `n` each release. */
export function RoundRing({ n, size }: { n: number; size: number }) {
  const [h1] = useHues()
  const reduce = useReduceMotion()
  const [v] = useState(() => new Animated.Value(1))
  useEffect(() => {
    if (!n || reduce) return
    v.setValue(0)
    const a = Animated.timing(v, { toValue: 1, duration: durations.roundRing, easing: easings.out, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [n, reduce, v])
  if (!n || reduce) return null
  return (
    <Animated.View
      testID="round-ring"
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `${h1}73`,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, (size + 28) / size] }) }],
      }}
    />
  )
}

/** The soft tangerine halo that breathes in and out around what waits for your yes, every 2.8 s. */
export function Breathe({ radius }: { radius: number }) {
  const { c } = useTheme()
  const reduce = useReduceMotion()
  const [v] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (reduce) return
    const half = durations.breathe / 2
    const ease = easings.std
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: half, easing: ease, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: half, easing: ease, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduce, v])
  if (reduce) return null
  return (
    <Animated.View
      testID="breathe"
      pointerEvents="none"
      style={{ position: 'absolute', left: -5, right: -5, top: -5, bottom: -5, borderRadius: radius + 5, backgroundColor: `${c.tangerine}38`, opacity: v }}
    />
  )
}

// ——— a card's picture ———

/** A band of light that crosses a card's picture once as it comes into view. */
export function Shine({ width, height }: { width: number; height: number }) {
  const reduce = useReduceMotion()
  const [v] = useState(() => new Animated.Value(0))
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (reduce) return
    const a = Animated.timing(v, { toValue: 1, duration: durations.shine, delay: 260, easing: easings.std, useNativeDriver: true })
    a.start(({ finished }) => finished && setDone(true))
    return () => a.stop()
  }, [reduce, v])
  if (reduce || done) return null
  const band = width * 0.46
  return (
    <Animated.View
      testID="card-shine"
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: -height * 0.2,
        width: band,
        height: height * 1.4,
        transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.6, width * 1.3] }) }, { skewX: '-18deg' }],
      }}>
      <Svg width={band} height={height * 1.4}>
        <Defs>
          <LinearGradient id="card-shine" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.42} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={band} height={height * 1.4} fill="url(#card-shine)" />
      </Svg>
    </Animated.View>
  )
}

/** Frost over a frozen card's picture: it crosses from left to right over 560 ms as the card freezes, and stays while
 * the card is frozen. */
export function Frost({ on, width, height }: { on: boolean; width: number; height: number }) {
  const reduce = useReduceMotion()
  const [open] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (!on) return open.setValue(0)
    if (reduce) return open.setValue(1)
    const a = Animated.timing(open, { toValue: 1, duration: durations.frost, easing: easings.out, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [on, reduce, open])
  if (!on) return null
  return (
    <View testID="card-frost" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Reveal open={open} width={width}>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="card-frost" x1="0" y1="0" x2="1" y2="0.47">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.62} />
              <Stop offset="0.45" stopColor="#D6ECFF" stopOpacity={0.4} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.56} />
            </LinearGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#card-frost)" />
        </Svg>
      </Reveal>
    </View>
  )
}

// ——— Home's blocks as the app opens ———

/** One of Home's blocks: as the app opens it rises in after the ones before it; any other time it is simply there. */
export function Rise({ index, children }: { index: number; children: ReactNode }) {
  const reduce = useReduceMotion()
  const [rising] = useState(() => openingNow() && !reduce)
  const [v] = useState(() => new Animated.Value(rising ? 0 : 1))
  useEffect(() => {
    if (reduce) return v.setValue(1)
    if (!rising) return
    const a = Animated.timing(v, { toValue: 1, duration: durations.page, delay: index * 60, easing: easings.out, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [index, reduce, rising, v])
  return <Animated.View style={{ gap: 14, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>{children}</Animated.View>
}
