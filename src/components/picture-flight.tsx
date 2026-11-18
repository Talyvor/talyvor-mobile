import { useNavigation } from 'expo-router'
import { type ComponentRef, type ReactNode, type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Animated, Platform, StyleSheet, View } from 'react-native'

import { durations, easings, useReduceMotion } from '../motion'
import { Face, type FaceState } from './face'

// B61.79 — Pocket Live DESIGN.md section 5: a pushed page that shows one agent carries its picture across, the face in
// the list growing into the face at the top of its page over 420 ms. Built on React Native's own Animated over the
// native stack, so no new package: the list's face lifts off when it is pressed and waits above both screens while the
// page slides in under it, then grows into the page's face once the page has arrived and drawn it. With Reduce Motion
// nothing lifts off. A page that has not drawn its face by a page's time after it arrived drops the flight, and its own
// face shows as it loads.

export type Rect = { x: number; y: number; width: number; height: number }
type FaceAgent = { id: string; name: string; colour?: string; face?: string; picture?: string }
type Host = ComponentRef<typeof View>
type Flight = { agent: FaceAgent; state: FaceState; from: Rect; to: Rect | null; arrived: boolean }

/** How long a lifted face waits for its page to arrive before it goes back to its row. */
const NEVER_ARRIVED = 2000

let flight: Flight | null = null
let dropTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function set(next: Flight | null) {
  flight = next
  for (const l of listeners) l()
}
function watch(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}
function clearDrop() {
  if (dropTimer) clearTimeout(dropTimer)
  dropTimer = null
}
const useFlight = () => useSyncExternalStore(watch, () => flight)

/** Where a view sits on the screen, read at once where the element can say (the phone's elements and the web's), and
 * through measureInWindow where it cannot; a seam for tests, which have no layout. */
export const measuring = {
  inWindow: (view: Host, done: (r: Rect) => void) => {
    if (typeof view.getBoundingClientRect !== 'function') return view.measureInWindow((x, y, width, height) => done({ x, y, width, height }))
    const { x, y, width, height } = view.getBoundingClientRect()
    done({ x, y, width, height })
  },
}

/** The flight ends: the page's own face shows and the one above the screens goes. */
function land() {
  clearDrop()
  set(null)
}
/** Ends the flight to this agent's page, and no other. */
function drop(agentId: string | undefined) {
  if (agentId && flight?.agent.id === agentId) land()
}

function arrive(agentId: string) {
  if (flight?.agent.id !== agentId || flight.arrived) return
  clearDrop()
  set({ ...flight, arrived: true })
  // The page has a page's time from arriving to draw its face, or the flight drops.
  if (!flight.to) dropTimer = setTimeout(() => drop(agentId), durations.page)
}

/** The face in a list row; `takeOff` lifts it off as the row opens the agent's page. */
export function useTakeOff(agent: FaceAgent, state: FaceState) {
  const ref = useRef<Host>(null)
  const reduce = useReduceMotion()
  const takeOff = () => {
    if (reduce || !ref.current) return
    measuring.inWindow(ref.current, (from) => {
      if (!from.width) return
      clearDrop()
      set({ agent, state, from, to: null, arrived: false })
      // A page that never arrives (the stack refused it) leaves the row's face where it was.
      dropTimer = setTimeout(() => drop(agent.id), NEVER_ARRIVED)
    })
  }
  const flying = useFlight()?.agent.id === agent.id
  return { ref, takeOff, flying }
}

/** A list row's face that lifts off when its row opens the agent: hidden while it flies. */
export function FlightSource({ face, flying, children }: { face: RefObject<Host | null>; flying: boolean; children: ReactNode }) {
  return (
    <View ref={face} testID="flight-source" collapsable={false} style={{ opacity: flying ? 0 : 1 }}>
      {children}
    </View>
  )
}

/** On the agent's page: tells the flight when the page has slid in, and drops it if the page goes first. */
export function usePageArrival(agentId: string | undefined) {
  const navigation = useNavigation()
  useEffect(() => {
    // The web's stack has no slide, so its page is where it lands at once.
    if (!agentId) return
    if (Platform.OS === 'web') arrive(agentId)
    const off = navigation.addListener('transitionEnd' as never, (e: { data?: { closing?: boolean } }) => {
      if (!e.data?.closing) arrive(agentId)
    })
    return off
  }, [navigation, agentId])
  useEffect(() => () => drop(agentId), [agentId])
}

/** The face at the top of the agent's page, where the flight lands; hidden until it has. */
export function FlightTarget({ agentId, children }: { agentId: string; children: ReactNode }) {
  const ref = useRef<Host>(null)
  const f = useFlight()
  const mine = f?.agent.id === agentId
  const arrived = mine && f.arrived
  const [laidOut, setLaidOut] = useState(false)
  useEffect(() => {
    if (!arrived || !laidOut || !ref.current || flight?.to) return
    measuring.inWindow(ref.current, (to) => {
      if (flight?.agent.id !== agentId || !to.width) return drop(agentId)
      clearDrop()
      set({ ...flight, to })
    })
  }, [arrived, laidOut, agentId])
  return (
    <View ref={ref} testID="flight-target" collapsable={false} onLayout={() => setLaidOut(true)} style={{ alignSelf: 'flex-start', opacity: mine ? 0 : 1 }}>
      {children}
    </View>
  )
}

/** Above every screen: the face in flight, waiting at the row it left, then growing into its page's face. */
export function PictureFlight() {
  const f = useFlight()
  const [t] = useState(() => new Animated.Value(0))
  const to = f?.to
  useEffect(() => {
    if (!to) return
    t.setValue(0)
    const anim = Animated.timing(t, { toValue: 1, duration: durations.page, easing: easings.out, useNativeDriver: true })
    anim.start(({ finished }) => finished && land())
    return () => {
      anim.stop()
      t.setValue(0)
    }
  }, [to, t])
  if (!f) return null
  const { from } = f
  // Drawn where it lands, at the size it lands, and moved and scaled from the row's face back to there.
  const at = to ?? from
  const dx = from.x + from.width / 2 - (at.x + at.width / 2)
  const dy = from.y + from.height / 2 - (at.y + at.height / 2)
  const s = from.width / at.width
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        testID="picture-flight"
        style={{
          position: 'absolute',
          left: at.x,
          top: at.y,
          transform: [
            { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }) },
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [s, 1] }) },
          ],
        }}>
        <Face agent={f.agent} state={f.state} size={at.width} />
      </Animated.View>
    </View>
  )
}
