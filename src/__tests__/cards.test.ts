/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CARDS, type Rgb } from '../cards'

// B57.121 — the 15 approved card faces (Nick, 10 Nov 2026) and the manifest that names them, the same ids as the web's.

const root = join(__dirname, '../..')
const dir = join(root, 'assets/cards')

// A JPEG's height and width follow its start-of-frame marker (FFC0 to FFCF, less DHT, JPG and DAC).
const size = (file: string) => {
  const jpg = readFileSync(join(dir, file))
  for (let i = 2; i < jpg.length; ) {
    const marker = jpg[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)]
    i += 2 + jpg.readUInt16BE(i + 2)
  }
  throw new Error(`${file} has no frame`)
}

// WCAG 2.2 relative luminance and contrast ratio.
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const TEXT: Record<'ink' | 'white', Rgb> = { ink: hex('#111216'), white: hex('#FFFFFF') }

test('every manifest entry has its file and every file has an entry', () => {
  const files = readdirSync(dir).sort()
  expect(CARDS.map((c) => c.file).sort()).toEqual(files)
  expect(files).toHaveLength(15)
  for (const c of CARDS) expect(c.file).toBe(`${c.id}.jpg`)
})

test('every file is 1536 × 968', () => {
  for (const c of CARDS) expect([c.file, ...size(c.file)]).toEqual([c.file, 1536, 968])
})

test('the families, tiers and helpers are the approved fifteen', () => {
  const by = (family: string) => CARDS.filter((c) => c.family === family).map((c) => (c.family === 'agent' ? c.helper : c.tier))
  expect(by('personal')).toEqual(['Daily', 'Premium', 'Platinum'])
  expect(by('corporate')).toEqual(['Team', 'Business', 'Enterprise'])
  expect(by('stablecoin')).toEqual(['Daily', 'Premium', 'Platinum'])
  expect(by('agent')).toEqual(['Remy', 'Sunny', 'Penny', 'Max', 'Nova', 'Ollie'])
  for (const c of CARDS) expect(c.badge?.label).toBe(c.family === 'stablecoin' ? 'USDC · EURC' : undefined)
})

test('each text colour meets 4.5:1 against its scrim, and each badge against its fill', () => {
  for (const c of CARDS) {
    expect([c.id, contrast(TEXT[c.text], c.scrim.colour) >= 4.5]).toEqual([c.id, true])
    // A white scrim carries ink and the light-background logo; a dark one carries white and the dark-background logo.
    expect([c.id, c.logo]).toEqual([c.id, c.text === 'ink' ? 'on-light' : 'on-dark'])
    if (c.badge) expect([c.id, contrast(hex(c.badge.ink), hex(c.badge.fill)) >= 4.5]).toEqual([c.id, true])
  }
})
