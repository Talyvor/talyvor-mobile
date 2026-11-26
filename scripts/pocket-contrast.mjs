#!/usr/bin/env node
/**
 * B61.99 — text over the moving background passes contrast on the real pixels.
 *
 *   node scripts/pocket-contrast.mjs
 *
 * The renderer is pocket-shots' (scripts/pocket-shots.mjs): the app exported for the web with the sample session
 * (POCKET_SHOTS=1), every BFF request answered from scripts/pocket/sample.mjs, Chromium at 390x844. Each screen opens
 * with Reduce Motion on, so the background holds its first frame; the clock is then paused, Reduce Motion turned off
 * so the background starts, and the clock moved on by hand, so the background is held at 0, 4, 8 and 12 s.
 *
 * At each moment every line of text in the window is measured against what is drawn behind it: the window is shot
 * with all text made transparent, and the line's colour (with its opacity) is laid over every pixel of that shot
 * under the line's box. The worst pixel must give at least 4.5 to 1, or 3 to 1 for large text (24 px, or 18.66 px
 * bold). Text a sheet or anything else covers is not drawn, so it is not measured; nor is a disabled control's.
 *
 * What fails is the glass: the page, its cards and the colour layer (washes, veil, sheen, grain and fade), shot with
 * the streams hidden. The streams are 1 px curves kept above the text by their heights (DESIGN.md section 6), and
 * the reference judges a curve that crosses text by eye: a line that passes on the glass and not with the curves
 * drawn is listed, with its screen and moment, for that look, and does not fail.
 *
 * Home, Agents, Pay, an agent's page and Approvals, light and dark, for a Business and a Personal account (the two
 * pairs of background colours). Any line under its ratio fails the run, as does a background that did not move.
 * B61.126: since the glass fills the whole screen (DESIGN.md section 6.0), also an agent's page in each of the seven
 * agent colours, and three sheets (Add money, an approval and Pause every agent) on their two soft washes. A sheet must
 * draw its washes; the glass under it may be covered, so it is not asked to move.
 * POCKET_CONTRAST_NO_EXPORT=1 reuses the last export in .pocket-shots; POCKET_CONTRAST_SHOTS=<folder> keeps each screen
 * as measured, at each moment.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import { SAMPLE_NOW, SAMPLE_TIME_ZONE, sampleBodyFor } from './pocket/sample.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(REPO, '.pocket-shots')
const BFF = 'https://bff.pocket-shots.invalid'
const SIZE = { width: 390, height: 844 }
const SCALE = 2
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' }

const SCREENS = [
  { name: 'Home', route: '/' },
  { name: 'Agents', route: '/agents' },
  { name: 'Pay', route: '/pay' },
  { name: "An agent's page", route: '/agents/agt_research' },
  { name: 'Approvals', route: '/approvals' },
  // An agent's page takes its own colour whatever the account, so each colour is measured once a theme.
  ...['cobalt', 'orchid', 'sky', 'mint', 'lemon', 'rose', 'lime'].map((colour) => ({ name: `Research's page in ${colour}`, route: '/agents/agt_research', colour, once: true })),
  { name: 'The Add money sheet', route: '/agents/agt_research', press: 'Add money to Research', sheet: true },
  { name: 'The approval sheet', route: '/approve/apr_acme', sheet: true },
  { name: 'The Pause every agent sheet', route: '/pause-all', sheet: true },
]
const ACCOUNTS = [
  { name: 'Business', type: 'business', kind: 'hybrid' },
  { name: 'Personal', type: 'personal', kind: 'fiat' },
]
const MOMENTS = [0, 4, 8, 12]

if (process.env.POCKET_CONTRAST_NO_EXPORT !== '1') {
  console.log('exporting the app for the web…')
  const exported = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', DIST, '--clear'], {
    cwd: REPO,
    stdio: 'inherit',
    env: { ...process.env, POCKET_SHOTS: '1', EXPO_PUBLIC_BFF_URL: BFF },
  })
  if (exported.status !== 0) process.exit(exported.status ?? 1)
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = join(DIST, path)
  if (!file.startsWith(DIST) || !extname(file) || !existsSync(file)) file = existsSync(join(DIST, `${path}.html`)) ? join(DIST, `${path}.html`) : join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
  res.end(await readFile(file))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const BASE = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ args: ['--disable-web-security'] })

/** Every line of text showing in the window, with its colour as drawn. Self-contained: it runs in the page. */
function linesOf() {
  const W = innerWidth
  const H = innerHeight
  const rgba = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a = '1'] = m[1].split(/[,\s/]+/).filter(Boolean)
    return [Number(r), Number(g), Number(b), Number(a)]
  }
  const out = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = (n.nodeValue || '').trim()
    const el = n.parentElement
    if (!text || !el || el.closest('script, style')) continue
    if (el.closest('[aria-disabled="true"], [disabled]')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility !== 'visible') continue
    const colour = rgba(cs.color)
    if (!colour) continue
    let alpha = colour[3]
    for (let p = el; p; p = p.parentElement) alpha *= Number(getComputedStyle(p).opacity)
    if (alpha <= 0) continue
    const size = parseFloat(cs.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
    const range = document.createRange()
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) {
      const x0 = Math.max(0, r.left)
      const y0 = Math.max(0, r.top)
      const x1 = Math.min(W, r.right)
      const y1 = Math.min(H, r.bottom)
      if (x1 - x0 < 1 || y1 - y0 < 1) continue
      // Drawn only where nothing covers it: the topmost thing at the line's middle is the text or its own box.
      const hit = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2)
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue
      out.push({ text: text.slice(0, 60), colour: colour.slice(0, 3), alpha, size, large, box: [x0, y0, x1, y1] })
    }
  }
  return out
}

/** The worst contrast of each line over the pixels behind it. Self-contained: it runs in a blank page. */
async function measure({ png, lines, scale }) {
  const img = new Image()
  img.src = `data:image/png;base64,${png}`
  await img.decode()
  const canvas = new OffscreenCanvas(img.width, img.height)
  const g = canvas.getContext('2d')
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, img.width, img.height).data
  const lin = (v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return lines.map((l) => {
    let worst = Infinity
    let under = null
    const [x0, y0, x1, y1] = l.box.map((v) => Math.round(v * scale))
    // The ground in cells of 2 by 2 CSS px, each the mean of its pixels: a glyph's stroke is read against the ground
    // around it, not against one speck of the grain.
    const cell = 2 * scale
    for (let y = y0; y + cell <= Math.min(y1, img.height); y += cell)
      for (let x = x0; x + cell <= Math.min(x1, img.width); x += cell) {
        const bg = [0, 0, 0]
        for (let dy = 0; dy < cell; dy++)
          for (let dx = 0; dx < cell; dx++) {
            const i = ((y + dy) * img.width + x + dx) * 4
            for (let k = 0; k < 3; k++) bg[k] += px[i + k] / (cell * cell)
          }
        const fg = l.colour.map((c, k) => c * l.alpha + bg[k] * (1 - l.alpha))
        const [a, b] = [lum(fg), lum(bg)]
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        if (ratio < worst) [worst, under] = [ratio, bg]
      }
    return { ...l, ratio: worst, under }
  })
}

const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const HIDE_TEXT = '* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important }'
const HIDE_STREAMS = '[data-testid="backdrop-streams"] { visibility: hidden !important }'

/** The window shot with these style rules on, then off again. */
async function shotWith(page, ...rules) {
  const sheet = await page.addStyleTag({ content: rules.join('\n') })
  const png = (await page.screenshot()).toString('base64')
  await sheet.evaluate((el) => el.remove())
  return png
}

const SHOTS = process.env.POCKET_CONTRAST_SHOTS ? resolve(process.env.POCKET_CONTRAST_SHOTS) : null
if (SHOTS) await mkdir(SHOTS, { recursive: true })
const meter = await browser.newPage()
const failures = []
const crossed = []
let measured = 0

/** The sample's answer with Research in `colour`. */
function recolour(v, colour) {
  if (Array.isArray(v)) return v.map((x) => recolour(x, colour))
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'colour' && v.id === 'agt_research' ? colour : recolour(x, colour)]))
}

for (const [a, account] of ACCOUNTS.entries())
  for (const dark of [false, true])
    for (const screen of SCREENS) {
      if (screen.once && a > 0) continue
      const label = `${screen.name}, ${account.name}, ${dark ? 'dark' : 'light'}`
      const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: SCALE, timezoneId: SAMPLE_TIME_ZONE, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
      // Random numbers held, so the streams' curves are drawn alike from run to run.
      await ctx.addInitScript(() => {
        let s = 0x2f5bff
        Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
      })
      const page = await ctx.newPage()
      await page.clock.install({ time: new Date(SAMPLE_NOW) })
      await page.route(`${BFF}/**`, (route) => {
        const url = new URL(route.request().url())
        const sample = url.pathname === '/api/workspace/account' ? { account_type: account.type, money_kind: account.kind } : sampleBodyFor(url.pathname)
        const body = screen.colour ? recolour(sample, screen.colour) : sample
        return route.fulfill({ status: body === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body ?? {}) })
      })
      await page.goto(BASE + screen.route)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(800)
      if (screen.press) {
        await page.getByRole('button', { name: screen.press }).click()
        await page.waitForTimeout(800)
      }
      if (screen.sheet) {
        if (!(await page.getByTestId('sheet-wash').count())) failures.push(`${label}: the sheet has no washes`)
      } else if (!(await page.getByTestId('backdrop').count())) failures.push(`${label}: no background on the screen`)
      // Time stops; then the background starts, at this moment, and moves only as the clock is moved.
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.waitForTimeout(300)
      let first = null
      let moved = false
      for (const [k, at] of MOMENTS.entries()) {
        if (k) await page.clock.runFor((at - MOMENTS[k - 1]) * 1000)
        await page.waitForTimeout(100)
        const lines = await page.evaluate(linesOf)
        if (SHOTS) await writeFile(join(SHOTS, `${label.replace(/[^A-Za-z]+/g, '-')}${at}s.png`), await page.screenshot())
        const glass = await shotWith(page, HIDE_TEXT, HIDE_STREAMS)
        const drawn = await shotWith(page, HIDE_TEXT)
        if (first === null) first = glass
        else if (glass !== first) moved = true
        const onGlass = await meter.evaluate(measure, { png: glass, lines, scale: SCALE })
        const withCurves = await meter.evaluate(measure, { png: drawn, lines, scale: SCALE })
        measured += lines.length
        const says = (r, need) =>
          `${label}, ${at} s: “${r.text}” ${hex(r.colour)}${r.alpha < 1 ? ` at ${Math.round(r.alpha * 100)}%` : ''}, ${r.size}px, over ${hex(r.under)}: ${r.ratio.toFixed(2)} to 1, needs ${need}`
        for (const [i, r] of onGlass.entries()) {
          const need = r.large ? 3 : 4.5
          if (r.ratio < need) failures.push(says(r, need))
          else if (withCurves[i].ratio < need) crossed.push(says(withCurves[i], need))
        }
      }
      if (!moved && !screen.sheet) failures.push(`${label}: the background did not move between 0 and 12 s, so the moments were not measured`)
      console.log(`${label}: measured at ${MOMENTS.join(', ')} s`)
      await ctx.close()
    }

await browser.close()
server.close()
console.log(`\n${measured} lines measured`)
if (crossed.length) console.log(`\n${crossed.length} line${crossed.length === 1 ? '' : 's'} pass on the glass and a stream crosses them, for a look by eye:\n${crossed.map((f) => `  · ${f}`).join('\n')}`)
if (failures.length) {
  console.log(`\n${failures.length} line${failures.length === 1 ? '' : 's'} under contrast:\n${failures.map((f) => `  ✗ ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('every line of text passes contrast over the background at 0, 4, 8 and 12 s, light and dark')
