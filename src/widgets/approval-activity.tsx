import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, kerning, minimumScaleFactor, monospacedDigit, padding, textCase } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets'

import type { Palette } from '../theme'

/** One held payment on the lock screen and in the Dynamic Island, formatted by the app: the widget runtime cannot format. */
export interface ApprovalActivityProps {
  /** waiting until it is decided; the activity ends showing approved or declined */
  state: 'waiting' | 'approved' | 'declined'
  /** the payee, or what the request is for */
  title: string
  amount: string
  /** whose money and who asked */
  detail: string
  /** what a tap does, e.g. `Tap to approve with Face ID` */
  hint: string
  palette: { dark: Palette; light: Palette }
}

// B41.36 — a held payment stays on the lock screen and the Dynamic Island until it is approved or declined.
const ApprovalActivity = (p: ApprovalActivityProps, env: LiveActivityEnvironment) => {
  'widget'
  const c = env.colorScheme === 'light' ? p.palette.light : p.palette.dark
  const tone = p.state === 'waiting' ? c.caution : p.state === 'approved' ? c.positive : c.inkMuted
  const word = p.state === 'waiting' ? 'Waiting for you' : p.state === 'approved' ? 'Approved' : 'Declined'
  const eyebrow = (color: string) => [font({ size: 11, weight: 'medium' }), kerning(1.6), textCase('uppercase'), foregroundStyle(color)]
  const figure = (size: number) => [font({ size, weight: 'medium', design: 'monospaced' }), monospacedDigit(), minimumScaleFactor(0.6), foregroundStyle(c.ink)]
  const body = (color: string) => [font({ size: 13 }), foregroundStyle(color)]
  const bottom = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={body(c.inkMuted)}>{p.detail}</Text>
      {p.state === 'waiting' ? <Text modifiers={body(c.accent)}>{p.hint}</Text> : null}
    </VStack>
  )

  return {
    banner: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 14 })]}>
        <Text modifiers={eyebrow(tone)}>{word}</Text>
        <HStack spacing={10}>
          <Text modifiers={body(c.ink)}>{p.title}</Text>
          <Spacer />
          <Text modifiers={figure(17)}>{p.amount}</Text>
        </HStack>
        {bottom}
      </VStack>
    ),
    compactLeading: <Text modifiers={eyebrow(tone)}>{p.state === 'waiting' ? 'Approve' : word}</Text>,
    compactTrailing: <Text modifiers={figure(13)}>{p.amount}</Text>,
    minimal: <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(tone)]}>●</Text>,
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 4 })]}>
        <Text modifiers={eyebrow(tone)}>{word}</Text>
        <Text modifiers={body(c.ink)}>{p.title}</Text>
      </VStack>
    ),
    expandedTrailing: <Text modifiers={[...figure(17), padding({ trailing: 4 })]}>{p.amount}</Text>,
    expandedBottom: bottom,
  }
}

export default createLiveActivity('TalyvorApproval', ApprovalActivity)
