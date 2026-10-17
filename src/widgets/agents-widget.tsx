import { HStack, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { containerBackground, font, foregroundStyle, kerning, monospacedDigit, textCase, widgetURL } from '@expo/ui/swift-ui/modifiers'
import { createWidget, type WidgetEnvironment } from 'expo-widgets'

import type { Palette } from '../theme'

/** Everything the widget shows, formatted by the app: the widget's runtime cannot import, fetch or format. */
export interface AgentsWidgetProps {
  signedIn: boolean
  safeToSpend: string
  pending: number
  /** pinned agents first; `pauseUrl` pauses it through the app, `openUrl` opens its screen (resume, fund) */
  agents: { id: string; name: string; balance: string; paused: boolean; pauseUrl: string; openUrl: string }[]
  /** pinned payees; `openUrl` opens the payment screen for it, and nothing is paid from the widget */
  payees: { id: string; name: string; last: string; openUrl: string }[]
  palette: { dark: Palette; light: Palette }
}

// Home-screen widget (iOS): safe to spend, what waits for approval, and pinned agents with Pause and Fund.
const AgentsWidget = (p: AgentsWidgetProps, env: WidgetEnvironment) => {
  'widget'
  const c = env.colorScheme === 'light' ? p.palette.light : p.palette.dark
  const eyebrow = [font({ size: 11, weight: 'medium' }), kerning(1.6), textCase('uppercase'), foregroundStyle(c.label)]
  const figure = (size: number, color: string) => [font({ size, weight: 'medium', design: 'monospaced' }), monospacedDigit(), foregroundStyle(color)]
  const body = (color: string) => [font({ size: 13 }), foregroundStyle(color)]
  const action = [font({ size: 13, weight: 'semibold' }), foregroundStyle(c.accent)]
  const waiting = p.pending ? `${p.pending} waiting for you` : 'Nothing waiting for you'

  if (!p.signedIn) {
    return (
      <VStack alignment="leading" modifiers={[containerBackground(c.canvas, 'widget'), widgetURL('talyvor://')]}>
        <Text modifiers={eyebrow}>Talyvor</Text>
        <Text modifiers={body(c.ink)}>Sign in to see your agents here.</Text>
      </VStack>
    )
  }

  // A small widget takes one tap anywhere, so it opens what is waiting.
  if (env.widgetFamily === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[containerBackground(c.canvas, 'widget'), widgetURL('talyvor://approvals')]}>
        <Text modifiers={eyebrow}>Safe to spend</Text>
        <Text modifiers={figure(18, c.ink)}>{p.safeToSpend}</Text>
        <Spacer />
        <Text modifiers={body(p.pending ? c.caution : c.inkMuted)}>{waiting}</Text>
      </VStack>
    )
  }

  const large = env.widgetFamily === 'systemLarge'
  const payees = p.payees.slice(0, large ? 2 : 1)
  const rows = p.agents.slice(0, (large ? 5 : 2) - payees.length)
  return (
    <VStack alignment="leading" spacing={8} modifiers={[containerBackground(c.canvas, 'widget')]}>
      <HStack>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={eyebrow}>Safe to spend</Text>
          <Text modifiers={figure(18, c.ink)}>{p.safeToSpend}</Text>
        </VStack>
        <Spacer />
        <Link destination="talyvor://approvals">
          <Text modifiers={body(p.pending ? c.caution : c.inkMuted)}>{waiting}</Text>
        </Link>
      </HStack>
      {rows.length === 0 ? <Text modifiers={body(c.inkMuted)}>No agents yet.</Text> : null}
      {rows.map((a) => (
        <HStack key={a.id} spacing={10}>
          <VStack alignment="leading" spacing={0}>
            <Text modifiers={body(c.ink)}>{a.name}</Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(a.paused ? c.caution : c.positive)]}>{a.paused ? 'Paused' : 'Active'}</Text>
          </VStack>
          <Spacer />
          <Text modifiers={figure(13, c.ink)}>{a.balance}</Text>
          {/* Resume is a decision to let it spend again, so it happens on the agent's screen, not from a home-screen tap. */}
          <Link destination={a.paused ? a.openUrl : a.pauseUrl}>
            <Text modifiers={action}>{a.paused ? 'Resume' : 'Pause'}</Text>
          </Link>
          <Link destination={a.openUrl}>
            <Text modifiers={action}>Fund</Text>
          </Link>
        </HStack>
      ))}
      {payees.map((y) => (
        <HStack key={y.id} spacing={10}>
          <VStack alignment="leading" spacing={0}>
            <Text modifiers={body(c.ink)}>{y.name}</Text>
            <Text modifiers={[font({ size: 11, design: 'monospaced' }), foregroundStyle(c.inkMuted)]}>{y.last}</Text>
          </VStack>
          <Spacer />
          <Link destination={y.openUrl}>
            <Text modifiers={action}>Pay</Text>
          </Link>
        </HStack>
      ))}
      <Spacer />
    </VStack>
  )
}

export default createWidget('TalyvorAgents', AgentsWidget)
