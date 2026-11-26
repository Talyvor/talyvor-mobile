import { useRef, useState, type ComponentProps } from 'react'
import { Animated, Pressable, type GestureResponderEvent, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native'

import { durations, easings, haptic, pressScale, spring, useReduceMotion, type PressKind } from '../motion'
import { useRipple, type RippleTone } from './effects'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

type PressProps = Omit<ComponentProps<typeof Pressable>, 'style'> & {
  /** how far it shrinks: buttons and rows 0.97, round actions 0.90, keypad keys 0.94 */
  kind?: PressKind
  /** a light haptic when the press lands; off for a decline */
  haptic?: boolean
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>)
  /** B61.130 — a ripple from where the finger lands, in its tone, clipped to `radius` */
  ripple?: RippleTone
  radius?: number
}

/** B61.73 — every pressable control: it shrinks under the finger and springs back, with a light haptic when the press
 * lands. With Reduce Motion on it does not move at all. */
export function Press({ kind = 'button', haptic: felt = true, style, onPress, onPressIn, onPressOut, disabled, ripple, radius = 0, children, onLayout, ...rest }: PressProps) {
  const reduce = useReduceMotion()
  const drops = useRipple(ripple, radius)
  const [scale] = useState(() => new Animated.Value(1))
  const [pressed, setPressed] = useState(false)
  const running = useRef<Animated.CompositeAnimation | null>(null)
  const to = (anim: Animated.CompositeAnimation) => {
    running.current?.stop()
    running.current = anim
    anim.start()
  }
  const drawn = typeof style === 'function' ? style({ pressed }) : style
  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true)
        drops.start(e)
        if (!reduce) to(Animated.timing(scale, { toValue: pressScale[kind], duration: durations.pressIn, easing: easings.std, useNativeDriver: true }))
        onPressIn?.(e)
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false)
        if (!reduce) to(Animated.spring(scale, { toValue: 1, ...spring, useNativeDriver: true }))
        onPressOut?.(e)
      }}
      onPress={(e: GestureResponderEvent) => {
        if (felt) haptic('light')
        onPress?.(e)
      }}
      style={[drawn, reduce ? null : { transform: [{ scale }] }]}
      onLayout={(e) => {
        drops.onLayout(e)
        onLayout?.(e)
      }}
      {...rest}>
      {typeof children === 'function' ? (
        children
      ) : (
        <>
          {children}
          {drops.layer}
        </>
      )}
    </AnimatedPressable>
  )
}
