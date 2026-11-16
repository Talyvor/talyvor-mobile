import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { accessibilityLabel, background, clipShape, font, foregroundStyle, frame, kerning, lineLimit, minimumScaleFactor, monospacedDigit, padding, resizable, textCase } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets'

import type { Palette } from '../theme'

/** One held payment on the lock screen and in the Dynamic Island, formatted by the app: the widget runtime cannot format. */
export interface ApprovalActivityProps {
  /** waiting until it is decided; the activity ends showing approved, declined or expired */
  state: 'waiting' | 'approved' | 'declined' | 'expired'
  /** the payee, or what the request is for */
  title: string
  /** in the currency that pays it, its symbol first: `$340.00`, `€412.00` */
  amount: string
  /** who asked: `Scout asks`, or `From the company’s account` */
  detail: string
  /** what a tap does, e.g. `Tap to approve with Face ID` */
  hint: string
  palette: { dark: Palette; light: Palette }
}

// B41.36 — a held payment stays on the lock screen and the Dynamic Island until it is approved or declined.
// B57.76 — in Pocket: the app icon and "Waiting for you", the payee and its amount, who asked, and what the one tap does,
// in Figtree with tabular figures (plugins/with-widget-symbol.js bundles both into the widget extension). The whole
// activity is the one tap target: it opens the app on that request (live-activity.ios.ts).
export const ApprovalActivityLayout = (p: ApprovalActivityProps, env: LiveActivityEnvironment) => {
  'widget'
  // The lock screen follows the phone's light or dark; the Dynamic Island is always black.
  const lock = env.colorScheme === 'light' ? p.palette.light : p.palette.dark
  const island = p.palette.dark
  const word = { waiting: 'Waiting for you', approved: 'Approved', declined: 'Declined', expired: 'Expired' }[p.state]
  const tone = (c: Palette) => (p.state === 'waiting' ? c.tangerineInk : p.state === 'approved' ? c.success : c.ink2)
  const eyebrow = (c: Palette) => [font({ family: 'Figtree-SemiBold', size: 11 }), kerning(1.2), textCase('uppercase'), foregroundStyle(tone(c))]
  const figure = (c: Palette, size: number) => [font({ family: 'Figtree-Bold', size }), monospacedDigit(), minimumScaleFactor(0.6), lineLimit(1), foregroundStyle(c.ink)]
  const text = (color: string, family = 'Figtree-Regular', size = 13) => [font({ family, size }), lineLimit(1), foregroundStyle(color)]
  const icon = (size: number) => <Image assetName="TalyvorAppIcon" modifiers={[resizable(), frame({ width: size, height: size }), clipShape('roundedRectangle', size * 0.225), accessibilityLabel('Talyvor')]} />
  const lower = (c: Palette) => (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={text(c.ink2)}>{p.detail}</Text>
      {p.state === 'waiting' ? <Text modifiers={text(c.ink, 'Figtree-SemiBold')}>{p.hint}</Text> : null}
    </VStack>
  )

  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 16 }), background(lock.page)]}>
        <HStack spacing={8}>
          {icon(20)}
          <Text modifiers={eyebrow(lock)}>{word}</Text>
          <Spacer />
        </HStack>
        <HStack spacing={10}>
          <Text modifiers={text(lock.ink, 'Figtree-SemiBold', 16)}>{p.title}</Text>
          <Spacer />
          <Text modifiers={figure(lock, 20)}>{p.amount}</Text>
        </HStack>
        {lower(lock)}
      </VStack>
    ),
    compactLeading: icon(18),
    compactTrailing: <Text modifiers={figure(island, 13)}>{p.amount}</Text>,
    minimal: icon(18),
    expandedLeading: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ leading: 4 })]}>
        <HStack spacing={6}>
          {icon(16)}
          <Text modifiers={eyebrow(island)}>{word}</Text>
        </HStack>
        <Text modifiers={text(island.ink, 'Figtree-SemiBold', 15)}>{p.title}</Text>
      </VStack>
    ),
    expandedTrailing: <Text modifiers={[...figure(island, 20), padding({ trailing: 4 })]}>{p.amount}</Text>,
    expandedBottom: lower(island),
  }
}

export default createLiveActivity('TalyvorApproval', ApprovalActivityLayout)
