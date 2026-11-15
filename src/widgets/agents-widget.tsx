import { HStack, Image, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { accessibilityLabel, containerBackground, font, foregroundStyle, frame, kerning, monospacedDigit, resizable, textCase, widgetURL } from '@expo/ui/swift-ui/modifiers'
import { createWidget, type WidgetEnvironment } from 'expo-widgets'

import type { Palette } from '../theme'

/** Everything the widget shows, formatted by the app: the widget's runtime cannot import, fetch or format. */
export interface AgentsWidgetProps {
  signedIn: boolean
  /** what the accounts hold, as Home's total: `$400.00`, or `$412.50 · 2.00 USDC` */
  total: string
  /** Home's words for it: `Your total`, or a Business's `Your company’s total` */
  totalLabel: string
  pending: number
  /** pinned agents first; `balance` is what its accounts hold, or '' for none; `pauseUrl` pauses it through the app, `openUrl` opens its screen (resume) */
  agents: { id: string; name: string; balance: string; paused: boolean; pauseUrl: string; openUrl: string }[]
  /** pinned payees; `openUrl` opens the payment screen for it, and nothing is paid from the widget */
  payees: { id: string; name: string; last: string; openUrl: string }[]
  palette: { dark: Palette; light: Palette }
}

// Home-screen widget (iOS): the total, what waits for approval, and pinned agents with what they hold and Pause.
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
        {/* The logo's symbol, bundled into the widget extension by plugins/with-widget-symbol.js. */}
        <Image
          assetName={env.colorScheme === 'light' ? 'TalyvorSymbolOnLight' : 'TalyvorSymbolOnDark'}
          modifiers={[resizable(), frame({ width: 48, height: 35 }), accessibilityLabel('Talyvor')]}
        />
        <Text modifiers={body(c.ink)}>Sign in to see your agents here.</Text>
      </VStack>
    )
  }

  // A small widget takes one tap anywhere, so it opens what is waiting.
  if (env.widgetFamily === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[containerBackground(c.canvas, 'widget'), widgetURL('talyvor://approvals')]}>
        <Text modifiers={eyebrow}>{p.totalLabel}</Text>
        <Text modifiers={figure(18, c.ink)}>{p.total}</Text>
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
          <Text modifiers={eyebrow}>{p.totalLabel}</Text>
          <Text modifiers={figure(18, c.ink)}>{p.total}</Text>
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
          {a.balance ? <Text modifiers={figure(13, c.ink)}>{a.balance}</Text> : null}
          {/* Resume is a decision to let it spend again, so it happens on the agent's screen, not from a home-screen tap. */}
          <Link destination={a.paused ? a.openUrl : a.pauseUrl}>
            <Text modifiers={action}>{a.paused ? 'Resume' : 'Pause'}</Text>
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
