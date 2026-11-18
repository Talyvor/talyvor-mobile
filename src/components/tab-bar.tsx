import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { BottomTabBar, type BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/index'

import { durations, easings, useReduceMotion } from '../motion'
import { useTheme } from '../theme'

// B61.76 — the floating tab bar of Pocket Live (pocket-live DESIGN.md section 7, index.html .ph .tabbar): 12 from the
// sides and 22 above the bottom inset, 66 high, radius 33, with a hairline. The prototype's glass needs a blur this app
// has no package for, so the bar is solid `page`, as the design asks where the phone offers no blur.
export const floatingBar = { side: 12, above: 22, height: 66, radius: 33 } as const

/** How far a tab's content scrolls past the bar's top, as the prototype's 120 under its 22 + 66. */
const clearance = 32

/** The bottom padding a tab's scroll needs so its last line clears the bar. */
export function tabBarClearance(bottomInset: number) {
  return bottomInset + floatingBar.above + floatingBar.height + clearance
}

const Spot = createContext({ index: 0, count: 1 })

/** The bar itself: the navigator's own, so the tabs, their names and the Approvals badge stay as they are, with the
 * marker behind them. */
export function FloatingTabBar(props: BottomTabBarProps) {
  return (
    <Spot.Provider value={{ index: props.state.index, count: props.state.routes.length }}>
      <BottomTabBar {...props} />
    </Spot.Provider>
  )
}

/** The tangerine marker under the tab you are on (46 by 30, 9 from the top): it slides to the next one over 420 ms. */
export function TabMarker() {
  const { c } = useTheme()
  const { index, count } = useContext(Spot)
  const reduce = useReduceMotion()
  const [width, setWidth] = useState(0)
  const [x] = useState(() => new Animated.Value(0))
  const placed = useRef(false)
  const step = width / count
  useEffect(() => {
    if (!step) return
    if (reduce || !placed.current) x.setValue(index * step)
    else Animated.timing(x, { toValue: index * step, duration: durations.marker, easing: easings.pop, useNativeDriver: true }).start()
    placed.current = true
  }, [index, step, reduce, x])
  return (
    <View testID="tabbar-marker-track" style={StyleSheet.absoluteFill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View testID="tabbar-marker" style={[styles.spot, { width: step || `${100 / count}%`, transform: [{ translateX: x }] }]}>
        <View style={[styles.pill, { backgroundColor: c.tangerine50 }]} />
      </Animated.View>
    </View>
  )
}

/** A tab's icon: it pops once, from 0.72, when its tab becomes the one you are on. */
export function PopIcon({ focused, children }: { focused: boolean; children: ReactNode }) {
  const reduce = useReduceMotion()
  const [scale] = useState(() => new Animated.Value(1))
  const was = useRef(focused)
  useEffect(() => {
    if (focused && !was.current && !reduce) {
      scale.setValue(0.72)
      Animated.timing(scale, { toValue: 1, duration: durations.marker, easing: easings.pop, useNativeDriver: true }).start()
    }
    was.current = focused
  }, [focused, reduce, scale])
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
}

const styles = StyleSheet.create({
  spot: { position: 'absolute', top: 9, left: 0, height: 30, alignItems: 'center' },
  pill: { width: 46, height: 30, borderRadius: 999 },
})
