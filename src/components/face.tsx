import { View } from 'react-native'
import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg'

import { agentColours, useTheme } from '../theme'

// B57.64 — an agent's face, as the web draws it (talyvor-suite B57.6, packages/ui/src/pocket/Face.tsx): seven colours
// by four shapes by three states on a 100-unit grid. White features on cobalt only, ink on the rest.
export const faceColours = ['cobalt', 'orchid', 'sky', 'mint', 'lemon', 'rose', 'lime'] as const
export const faceShapes = ['circle', 'squircle', 'hexagon', 'flower'] as const
export type FaceColour = (typeof faceColours)[number]
export type FaceShape = (typeof faceShapes)[number]
/** happy while it runs, asleep while paused, level when blocked or declined. */
export type FaceState = 'happy' | 'asleep' | 'level'

/** FNV-1a, 32-bit, over the id's UTF-8 bytes: the same pick Lens backfills its colour and face fields with. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h
}

/** An agent's colour and face: Lens's own fields when it sends them (B57.10), else the pick from its id. */
export function faceOf(agent: { id: string; colour?: string; face?: string }): { colour: FaceColour; shape: FaceShape } {
  const h = fnv1a(agent.id)
  const colour = faceColours.find((c) => c === agent.colour) ?? faceColours[h % 7]
  const shape = faceShapes.find((s) => s === agent.face) ?? faceShapes[Math.floor(h / 7) % 4]
  return { colour, shape }
}

function shapeOf(shape: FaceShape, fill: string) {
  switch (shape) {
    case 'circle':
      return <Circle cx="50" cy="50" r="50" fill={fill} />
    case 'squircle':
      return <Rect x="0" y="0" width="100" height="100" rx="31" fill={fill} />
    case 'hexagon':
      return <Polygon points="50,9 88,30 88,70 50,91 12,70 12,30" fill={fill} stroke={fill} strokeWidth="16" strokeLinejoin="round" />
    case 'flower':
      return (
        <>
          <Circle cx="31" cy="31" r="27" fill={fill} />
          <Circle cx="69" cy="31" r="27" fill={fill} />
          <Circle cx="31" cy="69" r="27" fill={fill} />
          <Circle cx="69" cy="69" r="27" fill={fill} />
          <Circle cx="50" cy="50" r="34" fill={fill} />
        </>
      )
  }
}

function featuresOf(state: FaceState, ink: string) {
  const line = { stroke: ink, strokeLinecap: 'round', fill: 'none' } as const
  if (state === 'asleep')
    return (
      <>
        <Path d="M30 47 Q37 53 44 47" {...line} strokeWidth="5.5" />
        <Path d="M56 47 Q63 53 70 47" {...line} strokeWidth="5.5" />
        <Path d="M44 65 L56 65" {...line} strokeWidth="5.5" />
      </>
    )
  return (
    <>
      <Circle cx="37" cy="45" r="6.6" fill={ink} />
      <Circle cx="63" cy="45" r="6.6" fill={ink} />
      <Path d={state === 'happy' ? 'M37 60 Q50 72 63 60' : 'M41 64 L59 64'} {...line} strokeWidth="5.8" />
    </>
  )
}

export function Face({
  agent,
  state = 'happy',
  waiting = false,
  size = 34,
}: {
  agent: { id: string; name: string; colour?: string; face?: string }
  state?: FaceState
  /** The tangerine badge: something of this agent's waits for a person. */
  waiting?: boolean
  /** Edge in points: 34 in a row, 44 on Home, 60 on the agent's own page. */
  size?: number
}) {
  const { c } = useTheme()
  const { colour, shape } = faceOf(agent)
  const badge = Math.max(9, size * 0.3)
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${agent.name} agent`} testID={`face-${colour}-${shape}-${state}`} style={{ width: size, height: size }}>
      <Svg viewBox="0 0 100 100" width={size} height={size}>
        {shapeOf(shape, agentColours[colour])}
        {featuresOf(state, colour === 'cobalt' ? '#FFFFFF' : '#111216')}
      </Svg>
      {/* pocket.css .face .badge: 30% of the face, at least 9, ringed in the page colour. */}
      {waiting ? (
        <View
          testID="face-badge"
          style={{ position: 'absolute', top: -2, right: -2, width: badge, height: badge, borderRadius: badge / 2, backgroundColor: c.tangerine, borderWidth: 2.5, borderColor: c.page }}
        />
      ) : null}
    </View>
  )
}
