import { render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { AgentCard } from '../components/card'
import { faceColours } from '../components/face'
import { agentColours } from '../theme'

// B57.126 — an agent's card on the phone is its helper's face for its colour, with the agent's own name and job line
// (cards handoff, 10 Nov 2026). Lime has no helper yet, so a lime agent keeps today's face on a plain lime card.

const helpers = { cobalt: 'remy', orchid: 'sunny', mint: 'penny', lemon: 'max', sky: 'nova', rose: 'ollie' } as const
// Every card art file the rendered tree draws.
type Node = { props?: { source?: { testUri?: string } }; children?: unknown[] | null }
const arts = (n: unknown): string[] =>
  Array.isArray(n) ? n.flatMap(arts) : n && typeof n === 'object' ? [(n as Node).props?.source?.testUri ?? ''].filter((u) => u.includes('/assets/cards/')).concat(arts((n as Node).children ?? [])) : []

const atlas = (colour: string) => ({ id: 'ag_atlas', name: 'Atlas', description: 'Research', colour, face: 'circle' })

it.each(faceColours)('a %s agent draws its card', async (colour) => {
  expect((await render(<AgentCard agent={atlas(colour)} width={342} />)).toJSON()).toMatchSnapshot()
})

it.each(Object.entries(helpers))('a %s agent wears %s, named as the agent', async (colour, helper) => {
  const { toJSON } = await render(<AgentCard agent={atlas(colour)} />)
  expect(arts(toJSON())).toEqual([`../../../assets/cards/agent-${helper}.jpg`])
  expect(screen.getByLabelText("Atlas, Research's agent card")).toBeTruthy()
  expect(screen.getByText('Atlas')).toBeTruthy()
  expect(screen.getByText('Research')).toBeTruthy()
  expect(screen.queryByText(new RegExp(helper, 'i'))).toBeNull()
})

test('a lime agent keeps its face on a plain lime card', async () => {
  const { toJSON } = await render(<AgentCard agent={atlas('lime')} />)
  expect(screen.getByLabelText("Atlas, Research's agent card")).toBeTruthy()
  expect(StyleSheet.flatten(screen.getByTestId('agent-card-plain').props.style).backgroundColor).toBe(agentColours.lime)
  expect(screen.getByTestId('face-lime-circle-happy', { includeHiddenElements: true })).toBeTruthy()
  expect(arts(toJSON())).toEqual([])
})

test('an agent with no job line is named alone', async () => {
  await render(<AgentCard agent={{ id: 'ag_1', name: 'Researcher', colour: 'cobalt' }} />)
  expect(screen.getByLabelText("Researcher's agent card")).toBeTruthy()
})
