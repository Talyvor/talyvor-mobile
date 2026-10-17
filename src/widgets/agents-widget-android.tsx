import { Box, Button, Column, Row, Spacer, Text, type ButtonProps } from '@expo/ui/jetpack-compose'
import { background, cornerRadius, fillMaxSize, fillMaxWidth, height, paddingAll, width } from '@expo/ui/jetpack-compose/modifiers'
import { createWidget, type WidgetEnvironment } from 'expo-widgets'
import type { JSX } from 'react'

import type { AgentsWidgetProps } from './agents-widget'

// Home-screen widget (Android): the iOS widget's content, drawn with Glance. Android gives the layout no size, so one layout fits all.
export const AgentsWidgetAndroid = (p: AgentsWidgetProps, env: WidgetEnvironment) => {
  'widget'
  // A widget tap carries this target; a talyvor:// one opens the app there (plugins/with-android-widget-links.js).
  const Tap = Button as (p: ButtonProps & { target: string }) => JSX.Element
  const c = env.colorScheme === 'light' ? p.palette.light : p.palette.dark
  const text = (fontSize: number, color: string, fontWeight?: '500' | '600') => ({ color, style: { fontSize, fontWeight } })
  const eyebrow = text(11, c.label, '500')
  const body = (color: string) => text(13, color)
  const tap = (label: string, url: string) => (
    <Tap target={url} colors={{ containerColor: c.accentTint, contentColor: c.accent }} modifiers={[cornerRadius(8)]}>
      <Text {...text(13, c.accent, '600')}>{label}</Text>
    </Tap>
  )
  // Glance has no weight, so a row's start and end are two full-width boxes stacked on each other.
  const ends = (start: JSX.Element, end: JSX.Element) => (
    <Box modifiers={[fillMaxWidth()]}>
      <Box modifiers={[fillMaxWidth()]} contentAlignment="centerStart">{start}</Box>
      <Box modifiers={[fillMaxWidth()]} contentAlignment="centerEnd">{end}</Box>
    </Box>
  )
  const frame = [fillMaxSize(), background(c.canvas), cornerRadius(16), paddingAll(12)]

  if (!p.signedIn) {
    return (
      <Column modifiers={frame}>
        <Text {...eyebrow}>TALYVOR</Text>
        <Text {...body(c.ink)}>Sign in to see your agents here.</Text>
        <Spacer modifiers={[height(8)]} />
        {tap('Open Talyvor', 'talyvor://')}
      </Column>
    )
  }

  return (
    <Column modifiers={frame}>
      {ends(
        <Column>
          <Text {...eyebrow}>SAFE TO SPEND</Text>
          <Text {...text(18, c.ink, '500')}>{p.safeToSpend}</Text>
        </Column>,
        tap(p.pending ? `${p.pending} waiting` : 'Nothing waiting', 'talyvor://approvals'),
      )}
      {p.agents.length === 0 ? <Text {...body(c.inkMuted)}>No agents yet.</Text> : null}
      {p.agents.slice(0, 4).map((a) => (
        <Column key={a.id} modifiers={[fillMaxWidth()]}>
          <Spacer modifiers={[height(8)]} />
          {ends(
            <Column>
              <Text {...body(c.ink)} maxLines={1}>{a.name}</Text>
              <Text {...text(11, a.paused ? c.caution : c.positive)}>{a.paused ? 'Paused' : 'Active'}</Text>
            </Column>,
            <Row verticalAlignment="center">
              <Text {...text(13, c.ink, '500')}>{a.balance}</Text>
              <Spacer modifiers={[width(8)]} />
              {/* Resume is a decision to let it spend again, so it happens on the agent's screen, not from a home-screen tap. */}
              {tap(a.paused ? 'Resume' : 'Pause', a.paused ? a.openUrl : a.pauseUrl)}
              <Spacer modifiers={[width(6)]} />
              {tap('Fund', a.openUrl)}
            </Row>,
          )}
        </Column>
      ))}
    </Column>
  )
}

export default createWidget('TalyvorAgents', AgentsWidgetAndroid)
