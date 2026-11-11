import { render, screen } from '@testing-library/react-native'
import { StyleSheet, useColorScheme } from 'react-native'

import { CARDS } from '../cards'
import { Card, cardLabel } from '../components/card'

// B57.123 — one Card component draws every approved face (Nick, 10 Nov 2026) from the B57.121 manifest, as
// layout/Card.dc.html lays it out: art, scrim, logo, tier and chip on owner cards, the badge, holder and one sub line.

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => null) }))
const scheme = useColorScheme as jest.Mock
beforeEach(() => scheme.mockReturnValue(null))

const sample = (id: string) => (id.startsWith('agent-') ? { holder: 'Atlas', sub: 'Research · pays in dollars' } : { holder: 'Sam Rivers', sub: 'Your everyday account' })

describe.each(['light', 'dark'] as const)('%s mode', (mode) => {
  beforeEach(() => scheme.mockReturnValue(mode))

  it.each(CARDS.map((c) => c.id))('%s draws its face', async (id) => {
    const face = CARDS.find((c) => c.id === id)!
    expect((await render(<Card face={face} {...sample(id)} width={342} />)).toJSON()).toMatchSnapshot()
  })
})

test('the art never names the holder: an agent called Atlas shows Atlas, not its helper', async () => {
  const remy = CARDS.find((c) => c.id === 'agent-remy')!
  await render(<Card face={remy} holder="Atlas" sub="Research · pays in dollars" />)
  expect(screen.getByText('Atlas')).toBeTruthy()
  expect(screen.queryByText('Remy')).toBeNull()
})

test('a 24-character agent name stays on one line and clear of the network corner', async () => {
  const name = 'Quarterly Reconciliation'
  expect(name).toHaveLength(24)
  for (const width of [428, 342, 280]) {
    for (const face of CARDS) {
      const { unmount } = await render(<Card face={face} holder={name} sub="Bookkeeping · pays in USDC" width={width} />)
      const holder = screen.getByText(name)
      expect(holder.props.numberOfLines).toBe(1)
      expect(holder.props.adjustsFontSizeToFit).toBe(true)
      const block = StyleSheet.flatten(screen.getByTestId('card-holder').props.style)
      // The network corner is 64 wide, 20 in from the right, as the layout keeps it: the name ends before it.
      const k = width / 428
      expect(block.left + block.width).toBeLessThanOrEqual(width - (20 + 64) * k)
      await unmount()
    }
  }
})

test('every card has its accessibilityLabel', async () => {
  for (const face of CARDS) {
    const { unmount } = await render(<Card face={face} {...sample(face.id)} />)
    expect(screen.getByLabelText(cardLabel(face, sample(face.id).holder, sample(face.id).sub))).toBeTruthy()
    await unmount()
  }
  const remy = CARDS.find((c) => c.id === 'agent-remy')!
  expect(cardLabel(remy, 'Remy', 'Research · pays in dollars')).toBe("Remy, Research's agent card")
  expect(cardLabel(CARDS.find((c) => c.id === 'stable-premium')!, 'Sam Rivers', '')).toBe("Sam Rivers's Premium stablecoin card")
})

// Every string the card renders, wherever it sits in the tree.
const strings = (node: unknown): string[] =>
  typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(strings) : node && typeof node === 'object' && 'children' in node ? strings(node.children) : []

test('no card shows a number, expiry, CVC or network mark, and agent cards carry no chip', async () => {
  for (const face of CARDS) {
    const { unmount, toJSON } = await render(<Card face={face} {...sample(face.id)} />)
    const words = strings(toJSON())
    expect(words).toContain(sample(face.id).holder)
    for (const w of words) expect(w).not.toMatch(/\d{4}|\d{2}\s*\/\s*\d{2}|CVC|CVV|visa|mastercard|amex|network/i)
    expect(screen.queryByTestId('card-chip', { includeHiddenElements: true }) !== null).toBe(face.family !== 'agent')
    await unmount()
  }
})
