import { formatLXC } from '@talyvor/bff-client'
import { render, screen } from '@testing-library/react-native'
import { useState } from 'react'
import { useColorScheme, View } from 'react-native'

import { Face, faceOf } from '../components/face'
import { Icon, iconNames } from '../components/icon'
import { Money, moneyParts } from '../components/money'
import { Bar, Button, Card, Chip, Field, Row, Sheet, Toggle } from '../components/ui'
import { pressEverything } from '../testing/press-everything'
import { agentColours, fonts, palettes, useTheme } from '../theme'

// B57.64 — the phone draws with Pocket's tokens (design/pocket/pocket.css), its faces and dollars-first money.

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => null) }))
const scheme = useColorScheme as jest.Mock
beforeEach(() => scheme.mockReturnValue(null))

/** WCAG's contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('the theme', () => {
  // Every colour and font of brand-v4 (tokens.css), which the phone drew until this item.
  const BRAND_V4 = ['#060A12', '#081220', '#0E1A2A', '#E6EEF7', '#7E93AB', '#90ACC0', '#3AD6C0', '#0E2B2E', '#45C77F', '#D6A93C', '#F0685C', '#F4F7FB', '#46586E', '#646B79', '#0F7A6C', '#C9E6E0', '#1D7A45', '#8A6A12', '#BF3B2E']

  it.each(['light', 'dark'] as const)('%s holds no brand-v4 colour or font', (mode) => {
    const values = Object.values(palettes[mode]).map((v) => v.toUpperCase())
    for (const old of BRAND_V4) expect(values).not.toContain(old)
    for (const f of Object.values(fonts)) expect(f).toMatch(/^(Figtree|BricolageGrotesque)_/)
  })

  it.each(['light', 'dark'] as const)('%s: every text and background pair reads at 4.5:1 or better', (mode) => {
    const p = palettes[mode]
    const pairs: [keyof typeof p, keyof typeof p][] = [
      ...(['ink', 'ink2', 'ink3', 'tangerineInk', 'success', 'danger'] as const).flatMap((t) => (['page', 'cloud'] as const).map((bg) => [t, bg] as [typeof t, typeof bg])),
      ['ink2', 'cloud2'],
      ['onPrimary', 'primary'],
      ['success', 'success50'],
      ['danger', 'danger50'],
      ['tangerineInk', 'tangerine50'],
    ]
    for (const [text, bg] of pairs) expect([text, bg, contrast(p[text], p[bg]) >= 4.5]).toEqual([text, bg, true])
    // A control's border against the page: 3:1.
    expect(contrast(p.control, p.page)).toBeGreaterThanOrEqual(3)
  })

  it('is light while the phone has no setting, and dark only when the phone says dark', async () => {
    const seen: boolean[] = []
    function Probe() {
      seen.push(useTheme().dark)
      return null
    }
    for (const s of [null, 'light', 'dark']) {
      scheme.mockReturnValue(s)
      await render(<Probe />)
    }
    expect(seen).toEqual([false, false, true])
  })
})

describe('money', () => {
  it('is dollars large and LXC small, and LXC large when the one switch flips', () => {
    expect(moneyParts(formatLXC(900_000_000, 0.1))).toEqual({ large: '$90.00', small: '900 LXC' })
    expect(moneyParts(formatLXC(900_000_000, 0.1, 'lxc-first'))).toEqual({ large: '900 LXC', small: '$90.00' })
    expect(moneyParts(formatLXC(900_000_000, null))).toEqual({ large: '900 LXC', small: null })
  })

  it('draws $450.00 for a currency amount, never 450.00 USD', async () => {
    await render(
      <>
        <Money micros={4_500_000_000} peg={0.1} />
        <Money minor={45000} currency="USD" />
        <Money minor={2400} currency="GBP" />
        <Money minor={400_000_000} currency="USDC" />
      </>,
    )
    expect(screen.getAllByText('$450.00')).toHaveLength(2)
    expect(screen.getByText('4,500 LXC')).toBeTruthy()
    expect(screen.getByText('£24.00')).toBeTruthy()
    expect(screen.getByText('400.00 USDC')).toBeTruthy()
    expect(screen.queryByText(/USD$/)).toBeNull()
    expect(screen.getAllByLabelText('$450.00 (4,500 LXC)')).toHaveLength(1)
  })
})

describe('an agent’s face', () => {
  // The web's three vectors (talyvor-suite B57.6, pocket-identity.test.tsx): FNV-1a 32-bit of the id,
  // colour = h mod 7, shape = (h div 7) mod 4.
  it.each([
    ['agt_research', 'mint', 'hexagon'],
    ['agt_sales', 'mint', 'flower'],
    ['agt_ops', 'rose', 'squircle'],
  ] as const)('%s picks the same colour and shape as the web and Lens', (id, colour, shape) => {
    expect(faceOf({ id })).toEqual({ colour, shape })
  })

  it('takes Lens’s own colour and face, and falls back to the pick for a value it does not know', () => {
    expect(faceOf({ id: 'agt_ops', colour: 'cobalt', face: 'circle' })).toEqual({ colour: 'cobalt', shape: 'circle' })
    expect(faceOf({ id: 'agt_ops', colour: 'teal', face: 'star' })).toEqual({ colour: 'rose', shape: 'squircle' })
  })

  it('draws white features only on cobalt, ink on the rest, at 3:1 or better, and badges only while something waits', async () => {
    for (const [colour, fill] of Object.entries(agentColours)) {
      const ink = colour === 'cobalt' ? '#FFFFFF' : '#111216'
      expect([colour, contrast(ink, fill) >= 3]).toEqual([colour, true])
    }
    const { rerender } = await render(<Face agent={{ id: 'agt_ops', name: 'Ops' }} waiting />)
    expect(screen.getByLabelText('Ops agent').props.testID).toBe('face-rose-squircle-happy')
    expect(screen.getByTestId('face-badge')).toBeTruthy()
    await rerender(<Face agent={{ id: 'agt_ops', name: 'Ops' }} state="asleep" />)
    expect(screen.getByLabelText('Ops agent').props.testID).toBe('face-rose-squircle-asleep')
    expect(screen.queryByTestId('face-badge')).toBeNull()
  })

  it('has the web’s icons', async () => {
    for (const name of ['home', 'approvals', 'agents', 'payments', 'statements', 'settings', 'pause', 'faceid', 'check', 'x']) expect(iconNames).toContain(name)
    await render(<Icon name="home" />)
    expect(screen.getByTestId('icon-home', { includeHiddenElements: true })).toBeTruthy()
  })
})

describe('the components', () => {
  function Specimens({ said }: { said: (what: string) => void }) {
    const [on, setOn] = useState(false)
    const [text, setText] = useState('')
    return (
      <View>
        <Card>
          <Chip tone="wait">Waiting</Chip>
          <Bar value={0.62} label="Budget used" />
          <Row title="Acme Hosting" sub="Today" right={<Money minor={34000} currency="USD" size={15} />} onPress={() => said('row')} />
          <Toggle label="Unusual-spend pause" value={on} onValueChange={setOn} />
          <Field label="Amount" value={text} onChangeText={setText} />
        </Card>
        <Card white>
          <Sheet>
            <Button label="Approve" variant="primary" onPress={() => said('approve')} />
            <Button label="Not now" variant="secondary" onPress={() => said('later')} />
            <Button label="Details" variant="outline" onPress={() => said('details')} />
            <Button label="Decline" variant="danger" onPress={() => said('decline')} />
          </Sheet>
        </Card>
      </View>
    )
  }

  it('every control does something when pressed', async () => {
    const report = await pressEverything((said) => <Specimens said={said} />)
    expect(report.dead).toEqual([])
    expect(report.pressed).toBe(6)
  })

  it('buttons are 52 tall and the primary one is full width', async () => {
    await render(<Button label="Approve" variant="primary" onPress={() => undefined} />)
    const style = Object.assign({}, ...[screen.getByRole('button').props.style].flat(Infinity).filter(Boolean))
    expect(style).toMatchObject({ height: 52, alignSelf: 'stretch', backgroundColor: palettes.light.primary })
  })
})
