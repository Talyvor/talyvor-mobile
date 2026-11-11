import { Image, Text, View } from 'react-native'
import Svg, { Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg'

import { CARDS, type CardFace } from '../cards'
import { agentColours, fonts, useTheme } from '../theme'
import { Face, faceOf } from './face'

// B57.123 — one card face, drawn from the B57.121 manifest exactly as layout/Card.dc.html lays it out at 428 × 270 and
// scaled with the card: the art, a left-to-right scrim, the logo top left 22 in, the tier, family and chip on owner
// cards, the "USDC · EURC" badge on stablecoin cards, and the holder bottom left with one sub line. The art never
// carries a name, so an agent called "Atlas" never shows "Remy". No number, expiry, CVC or back is ever drawn, and the
// network corner bottom right stays empty until an issuer gives its mark: the holder's line ends before it.

const W = 428
const H = 270
/** The network corner: 64 wide, 20 in from the right. The holder's line stops 12 short of it. */
const HOLDER_WIDTH = W - 22 - (20 + 64 + 12)

const TEXT = {
  ink: { ink: '#111216', ink2: '#3E4452' },
  white: { ink: '#FFFFFF', ink2: '#D2D6DE' },
} as const
const LOGO = {
  'on-light': require('../../assets/logo/talyvor-logo-small-on-light-480.png'),
  'on-dark': require('../../assets/logo/talyvor-logo-small-on-dark-480.png'),
}

const family = { personal: 'Personal', corporate: 'Corporate', stablecoin: 'Stablecoin' } as const

/** The alt text: "Remy, Research's agent card" for an agent, "Sam Rivers's Premium personal card" for an owner. */
export function cardLabel(face: CardFace, holder: string, sub: string): string {
  if (face.family === 'agent') return agentCardLabel(holder, sub)
  return `${holder}'s ${face.tier} ${family[face.family].toLowerCase()} card`
}

export function agentCardLabel(holder: string, sub: string): string {
  const job = sub.split(' · ')[0].trim()
  return job ? `${holder}, ${job}'s agent card` : `${holder}'s agent card`
}

function Chip({ k }: { k: number }) {
  const line = 'rgba(17,18,22,0.22)'
  return (
    <Svg testID="card-chip" width={44 * k} height={34 * k} viewBox="0 0 44 34" style={{ position: 'absolute', left: 24 * k, top: 100 * k }}>
      <Defs>
        <LinearGradient id="card-chip" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F1E7C8" />
          <Stop offset="1" stopColor="#C9B47E" />
        </LinearGradient>
      </Defs>
      <Rect x="0.5" y="0.5" width="43" height="33" rx="6.5" fill="url(#card-chip)" stroke="rgba(17,18,22,0.2)" strokeWidth="1" />
      <Line x1="0" y1="11.5" x2="44" y2="11.5" stroke={line} strokeWidth="1" />
      <Line x1="0" y1="22.5" x2="44" y2="22.5" stroke={line} strokeWidth="1" />
      <Line x1="16.5" y1="0" x2="16.5" y2="34" stroke={line} strokeWidth="1" />
      <Line x1="28.5" y1="0" x2="28.5" y2="34" stroke={line} strokeWidth="1" />
    </Svg>
  )
}

function Holder({ k, owner, ink, holder, sub }: { k: number; owner: boolean; ink: (typeof TEXT)[keyof typeof TEXT]; holder: string; sub: string }) {
  return (
    <View testID="card-holder" style={{ position: 'absolute', left: 22 * k, bottom: 20 * k, width: HOLDER_WIDTH * k }}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={{
          fontFamily: fonts.display,
          fontSize: (owner ? 15 : 26) * k,
          lineHeight: (owner ? 17 : 29) * k,
          letterSpacing: (owner ? -0.15 : -0.26) * k,
          color: ink.ink,
        }}
      >
        {holder}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={{ fontFamily: fonts.uiMedium, fontSize: 12 * k, color: ink.ink2, marginTop: 4 * k }}>
        {sub}
      </Text>
    </View>
  )
}

/** The card's edge: the layout's shadow on a light page; on a dark one a hairline instead. */
function frame(width: number, k: number, dark: boolean, line: string) {
  return [
    { width, height: H * k, borderRadius: 18 * k },
    dark
      ? { borderWidth: 1, borderColor: line }
      : { shadowColor: '#111216', shadowOpacity: 0.18, shadowRadius: 17 * k, shadowOffset: { width: 0, height: 14 * k }, elevation: 6 },
  ]
}

export function Card({
  face,
  holder,
  sub,
  width = W,
}: {
  face: CardFace
  /** The account holder's name on an owner card; the agent's own name on an agent card. */
  holder: string
  /** One line under the holder: an agent's job line, or the owner card's own line. */
  sub: string
  /** Edge in points; everything on the face scales with it. */
  width?: number
}) {
  const { c, dark } = useTheme()
  const k = width / W
  const ink = TEXT[face.text]
  const owner = face.family !== 'agent'
  const [r, g, b] = face.scrim.colour
  const scrimId = `card-scrim-${face.id}`

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={cardLabel(face, holder, sub)}
      style={frame(width, k, dark, c.line)}
    >
      <View style={{ flex: 1, borderRadius: 18 * k, overflow: 'hidden', backgroundColor: '#111216' }}>
        <Image source={face.art} resizeMode="cover" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
        <Svg width="100%" height="100%" style={{ position: 'absolute', left: 0, top: 0 }}>
          <Defs>
            <LinearGradient id={scrimId} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={`rgb(${r},${g},${b})`} stopOpacity={face.scrim.alpha} />
              <Stop offset="0.55" stopColor={`rgb(${r},${g},${b})`} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${scrimId})`} />
        </Svg>
        <Image source={LOGO[face.logo]} resizeMode="contain" style={{ position: 'absolute', left: 22 * k, top: 22 * k, width: 112 * k, height: ((112 * 153) / 480) * k }} />
        {owner && (
          <View style={{ position: 'absolute', right: 22 * k, top: 18 * k, alignItems: 'flex-end' }}>
            <Text allowFontScaling={false} style={{ fontFamily: fonts.display, fontSize: 18 * k, lineHeight: 20 * k, letterSpacing: -0.18 * k, color: ink.ink }}>
              {face.tier}
            </Text>
            <Text
              allowFontScaling={false}
              style={{ fontFamily: fonts.uiBold, fontSize: 10.5 * k, letterSpacing: 0.84 * k, textTransform: 'uppercase', color: ink.ink2, marginTop: 3 * k }}
            >
              {family[face.family]}
            </Text>
          </View>
        )}
        {owner && <Chip k={k} />}
        {face.badge && (
          <View
            style={{
              position: 'absolute',
              left: 22 * k,
              top: 148 * k,
              height: 22 * k,
              paddingHorizontal: 10 * k,
              borderRadius: 999,
              justifyContent: 'center',
              backgroundColor: face.badge.fill,
            }}
          >
            <Text allowFontScaling={false} style={{ fontFamily: fonts.uiBold, fontSize: 11.5 * k, color: face.badge.ink }}>
              {face.badge.label}
            </Text>
          </View>
        )}
        <Holder k={k} owner={owner} ink={ink} holder={holder} sub={sub} />
      </View>
    </View>
  )
}

/** B57.126 — an agent's own card: the helper drawn for its colour (Remy for cobalt, and so on), with the agent's own name
 * and its job line. Lime has no helper yet, so a lime agent keeps today's face on a plain lime card (cards handoff,
 * 10 Nov 2026). The colour is the one Lens stores for the agent, or the pick from its id, as its face uses. */
export function AgentCard({ agent, width = W }: { agent: { id: string; name: string; description?: string; colour?: string; face?: string }; width?: number }) {
  const { c, dark } = useTheme()
  const { colour } = faceOf(agent)
  const sub = agent.description ?? ''
  const helper = CARDS.find((f) => f.family === 'agent' && f.colour.name === colour)
  if (helper) return <Card face={helper} holder={agent.name} sub={sub} width={width} />

  const k = width / W
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={agentCardLabel(agent.name, sub)} style={frame(width, k, dark, c.line)}>
      <View testID="agent-card-plain" style={{ flex: 1, borderRadius: 18 * k, overflow: 'hidden', backgroundColor: agentColours[colour] }}>
        <Image source={LOGO['on-light']} resizeMode="contain" style={{ position: 'absolute', left: 22 * k, top: 22 * k, width: 112 * k, height: ((112 * 153) / 480) * k }} />
        <View style={{ position: 'absolute', right: 22 * k, top: 22 * k }}>
          <Face agent={agent} size={72 * k} />
        </View>
        <Holder k={k} owner={false} ink={TEXT.ink} holder={agent.name} sub={sub} />
      </View>
    </View>
  )
}
