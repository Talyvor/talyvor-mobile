import type { WorkspaceAccount } from '@talyvor/bff-client'
import type { ImageSourcePropType } from 'react-native'

// B57.121 — the approved Talyvor card faces (Nick, 10 Nov 2026): 15 artworks with no text, and what the Card component
// draws on each, as layout/Card.dc.html sets it. The ids match the web's manifest so both apps name a card the same way.
// The art never carries a name: the holder and the sub line are drawn on top, so an agent called "Atlas" never shows "Remy".

export type Rgb = readonly [number, number, number]
export type CardFamily = 'personal' | 'corporate' | 'stablecoin' | 'agent'

type Face = {
  id: string
  file: string
  art: ImageSourcePropType
  /** The holder, tier and sub line: ink on a light scrim, white on a dark one. */
  text: 'ink' | 'white'
  /** Which logo file sits top left: the one drawn for a light background or for a dark one. */
  logo: 'on-light' | 'on-dark'
  /** Left to right, from this colour at `alpha` to clear at 55% of the width, so the text on the left stays readable. */
  scrim: { colour: Rgb; alpha: number }
  badge?: { label: string; fill: string; ink: string }
}
export type OwnerCard = Face & { family: 'personal' | 'corporate' | 'stablecoin'; tier: string }
/** An agent's virtual card: the helper is the face, the colour is the one Lens stores for the agent today. */
export type AgentCard = Face & { family: 'agent'; helper: string; colour: { name: string; hex: string } }
export type CardFace = OwnerCard | AgentCard

const onLight = { text: 'ink', logo: 'on-light', scrim: { colour: [255, 255, 255], alpha: 0.55 } } as const
const onDark = { text: 'white', logo: 'on-dark', scrim: { colour: [10, 11, 14], alpha: 0.45 } } as const
const usdcEurc = (fill: string, ink: string) => ({ badge: { label: 'USDC · EURC', fill, ink } })

// Every art file is named after its card.
const face = (c: CardFace extends infer F ? (F extends unknown ? Omit<F, 'file'> : never) : never) => ({ ...c, file: `${c.id}.jpg` }) as CardFace

export const CARDS: CardFace[] = [
  face({ id: 'daily', family: 'personal', tier: 'Daily', art: require('../assets/cards/daily.jpg'), ...onLight }),
  face({ id: 'premium', family: 'personal', tier: 'Premium', art: require('../assets/cards/premium.jpg'), ...onDark }),
  face({ id: 'platinum', family: 'personal', tier: 'Platinum', art: require('../assets/cards/platinum.jpg'), ...onLight }),
  face({ id: 'team', family: 'corporate', tier: 'Team', art: require('../assets/cards/team.jpg'), ...onDark }),
  face({ id: 'business', family: 'corporate', tier: 'Business', art: require('../assets/cards/business.jpg'), ...onDark }),
  face({ id: 'enterprise', family: 'corporate', tier: 'Enterprise', art: require('../assets/cards/enterprise.jpg'), ...onDark }),
  face({ id: 'stable', family: 'stablecoin', tier: 'Daily', art: require('../assets/cards/stable.jpg'), ...onLight, ...usdcEurc('#111216', '#FFFFFF') }),
  face({ id: 'stable-premium', family: 'stablecoin', tier: 'Premium', art: require('../assets/cards/stable-premium.jpg'), ...onDark, ...usdcEurc('#16C79A', '#111216') }),
  face({ id: 'stable-platinum', family: 'stablecoin', tier: 'Platinum', art: require('../assets/cards/stable-platinum.jpg'), ...onLight, ...usdcEurc('#111216', '#FFFFFF') }),
  face({ id: 'agent-remy', family: 'agent', helper: 'Remy', colour: { name: 'cobalt', hex: '#2F5BFF' }, art: require('../assets/cards/agent-remy.jpg'), ...onDark }),
  face({ id: 'agent-sunny', family: 'agent', helper: 'Sunny', colour: { name: 'orchid', hex: '#B65CFF' }, art: require('../assets/cards/agent-sunny.jpg'), ...onDark }),
  face({ id: 'agent-penny', family: 'agent', helper: 'Penny', colour: { name: 'mint', hex: '#16C79A' }, art: require('../assets/cards/agent-penny.jpg'), ...onLight }),
  face({ id: 'agent-max', family: 'agent', helper: 'Max', colour: { name: 'lemon', hex: '#FFD43B' }, art: require('../assets/cards/agent-max.jpg'), ...onLight }),
  face({ id: 'agent-nova', family: 'agent', helper: 'Nova', colour: { name: 'sky', hex: '#39C2FF' }, art: require('../assets/cards/agent-nova.jpg'), ...onLight }),
  face({ id: 'agent-ollie', family: 'agent', helper: 'Ollie', colour: { name: 'rose', hex: '#FF5C8A' }, art: require('../assets/cards/agent-ollie.jpg'), ...onLight }),
]

// B57.128 — the owner's or company's own card shows its account's default tier: Daily for a personal account, Team for a
// business one, and Stablecoin Daily for a stablecoin-only account of either type. Only the picture follows it; no plan,
// price, limit or fee reads it. The web's display tier is not readable from the phone yet, so the default is shown.
export function ownerFace(account: Pick<WorkspaceAccount, 'account_type' | 'money_kind'>): OwnerCard {
  const id = account.money_kind === 'stablecoin' ? 'stable' : account.account_type === 'business' ? 'team' : 'daily'
  return CARDS.find((c) => c.id === id) as OwnerCard
}

/** The owner card's one line under the holder, in layout/Card.dc.html's words. */
export const OWNER_SUB: Record<string, string> = {
  daily: 'Your everyday account',
  premium: 'Fiat, stablecoins or both',
  platinum: 'Fiat, stablecoins or both',
  team: 'For your team and its agents',
  business: 'For every team and agent',
  enterprise: 'Your contract, your limits',
  stable: 'Spends from your own wallet',
  'stable-premium': 'Spends from your own wallet',
  'stable-platinum': 'Spends from your own wallet',
}
