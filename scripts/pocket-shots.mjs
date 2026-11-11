#!/usr/bin/env node
/**
 * B57.64 — pocket-shots for the phone: the app beside the Pocket reference, as talyvor-suite's B57.1 does for the web.
 *
 *   node scripts/pocket-shots.mjs <item> <checks.json>
 *
 * checks.json is a list of { route, screen, dark?, words?, why?, fill?, press?, scroll? }: the app's address, the reference's phone
 * screen id (design/pocket/README.md's tables, p-*, with `+<dialog>` for one of its sheets), whether to shoot it with the
 * phone set to dark, and `"words": "report"` with `why` for a screen whose words are a later item's (they are listed, not
 * failed). `fill` types into the app's fields by their labels and `press` then presses its buttons by their names, in
 * order, before the shot: a sheet the reference opens from a screen is shot the same way in the app. `scroll` names the
 * words the app's shot scrolls to, for a part of a screen below the fold.
 *
 * It exports the app for the web once (npx expo export --platform web) with the sample session in the keychain
 * (metro.config.js, POCKET_SHOTS=1), serves it, answers every BFF request from scripts/pocket/sample.mjs, and shoots
 * each check at 390x844 with the reference beside it, into docs/pr-screenshots/<item>/<screen>[-dark]-390.png (app
 * left, reference right). Then the checks, each of which fails the run:
 *   · the words check: every heading, button, tab, chip and label on the reference screen is on the app's;
 *   · the layout check: no sideways scroll, no text past its box.
 * The press check is jest's: src/testing/press-everything.tsx.
 *
 * The reference folder is POCKET_REFERENCE, default ~/talyvor-queue/design/pocket.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import { SAMPLE_NOW, SAMPLE_TIME_ZONE, sampleBodyFor } from './pocket/sample.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(REPO, '.pocket-shots')
const BFF = 'https://bff.pocket-shots.invalid'
const REFERENCE = resolve(process.env.POCKET_REFERENCE || join(homedir(), 'talyvor-queue/design/pocket'))
const SIZE = { width: 390, height: 844 }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' }

const [item, checksArg] = process.argv.slice(2)
if (!item || !checksArg || !/^[\w.-]+$/.test(item)) {
  console.error('usage: node scripts/pocket-shots.mjs <item> <checks.json>')
  process.exit(2)
}
const checks = JSON.parse(await readFile(resolve(checksArg), 'utf8'))
if (!existsSync(join(REFERENCE, 'index.html'))) {
  console.error(`no Pocket reference at ${REFERENCE}: set POCKET_REFERENCE`)
  process.exit(2)
}

console.log('exporting the app for the web…')
const exported = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', DIST, '--clear'], {
  cwd: REPO,
  stdio: 'inherit',
  env: { ...process.env, POCKET_SHOTS: '1', EXPO_PUBLIC_BFF_URL: BFF },
})
if (exported.status !== 0) process.exit(exported.status ?? 1)

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = join(DIST, path)
  if (!file.startsWith(DIST) || !extname(file) || !existsSync(file)) file = existsSync(join(DIST, `${path}.html`)) ? join(DIST, `${path}.html`) : join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
  res.end(await readFile(file))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const BASE = `http://127.0.0.1:${server.address().port}`

const OUT = join(REPO, 'docs/pr-screenshots', item)
await mkdir(OUT, { recursive: true })
// The app's origin is the local server and the BFF's is another: web security off, so no CORS preflight is in the way.
const browser = await chromium.launch({ args: ['--disable-web-security'] })
const failures = []
const unanswered = new Set()

/** Every heading, button, tab, chip and label showing under `root`. Self-contained: it runs in the page. */
function wordsOf(root) {
  const KINDS = [
    ['heading', 'h1, h2, h3, h4, [role="heading"]'],
    ['button', 'button, [role="button"]'],
    ['tab', '[role="tab"], .tabs a'],
    ['chip', '.chip, .status'],
    ['label', 'label, .eyebrow'],
  ]
  const out = []
  const seen = new Set()
  for (const [kind, sel] of KINDS)
    for (const el of root.querySelectorAll(sel)) {
      if (el.closest('[hidden], [aria-hidden="true"]') || !el.checkVisibility()) continue
      const text = ((el.getAttribute('aria-label') || '').trim() || el.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      out.push({ kind, text })
    }
  return out
}

/** Every word a person can read or a screen reader can say on the page. Self-contained: it runs in the page. */
function haystackOf(root) {
  const texts = []
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement?.closest('script, style, [aria-hidden="true"]')) texts.push(n.nodeValue || '')
  const names = [...root.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'))
  return [texts.join(''), texts.join(' '), names.join(' ')].join('\n')
}

/** Problems a person would see at 390: sideways scroll, text past its box. Self-contained: it runs in the page. */
function layoutProblems() {
  const out = []
  const root = document.documentElement
  if (root.scrollWidth > root.clientWidth + 1) out.push(`the page scrolls sideways: ${root.scrollWidth}px wide in a ${root.clientWidth}px window`)
  for (const el of document.body.querySelectorAll('*')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue || '').trim())) continue
    if (el.clientWidth <= 1 || getComputedStyle(el).display === 'inline') continue
    if (el.scrollWidth > el.clientWidth + 1) out.push(`“${el.textContent.trim().slice(0, 60)}” runs past its box`)
  }
  return out
}

/** Words compared as a person reads them; an LXC figure beside a dollar one is the small print, so only dollars must match. */
function normalise(s) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\(?\s*[−-]?[\d,.]+\s*LXC\s*\)?/g, (m) => (/\d/.test(m) ? ' ' : m))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function reference(c) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto('file://' + join(REFERENCE, 'index.html'))
  await page.waitForFunction(() => window.__proto)
  await page.evaluate((s) => window.__proto.open(s), c.screen)
  if ((await page.evaluate(() => window.__proto.current())) !== c.screen) throw new Error(`the reference has no screen ${c.screen}`)
  if (c.dark) await page.evaluate(() => document.querySelectorAll('#proto .phold .pk').forEach((el) => el.classList.replace('pk-light', 'pk-dark') || el.classList.add('pk-dark')))
  await page.waitForTimeout(300)
  const hold = page.locator('#proto .phold > *').first()
  const words = await page.evaluate(`(${wordsOf})(document.querySelector('#proto .phold'))`)
  const png = await hold.screenshot()
  await page.close()
  return { words, png }
}

async function app(c) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 2, timezoneId: SAMPLE_TIME_ZONE, colorScheme: c.dark ? 'dark' : 'light' })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(new Date(SAMPLE_NOW))
  await page.route(`${BFF}/**`, (route) => {
    const url = new URL(route.request().url())
    const body = sampleBodyFor(url.pathname)
    if (body === undefined) unanswered.add(`${route.request().method()} ${url.pathname}${url.search}`)
    return route.fulfill({ status: body === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body ?? {}) })
  })
  await page.goto(BASE + c.route)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  for (const [label, value] of Object.entries(c.fill ?? {})) await page.getByLabel(label, { exact: true }).fill(value)
  for (const name of c.press ?? []) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(500)
  }
  if (c.scroll) await page.getByText(c.scroll, { exact: true }).first().scrollIntoViewIfNeeded()
  return { ctx, page }
}

async function sideBySide(appPng, refPng, file) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  const img = (b, w) => `<img style="display:block;width:${w}px" src="data:image/png;base64,${b.toString('base64')}">`
  await page.setContent(
    `<body style="margin:0;background:#888;font:14px sans-serif"><div style="display:flex;gap:24px;align-items:flex-start;padding:16px;width:max-content">` +
      `<figure style="margin:0">${img(appPng, SIZE.width)}<figcaption>The app at 390x844</figcaption></figure>` +
      `<figure style="margin:0">${img(refPng, SIZE.width)}<figcaption>Pocket reference</figcaption></figure></div></body>`,
  )
  await page.locator('body > div').screenshot({ path: file })
  await page.close()
}

for (const c of checks) {
  const label = `${c.screen}${c.dark ? '-dark' : ''}`
  console.log(`\n${label} — the app at ${c.route}`)
  const ref = await reference(c)
  const { ctx, page } = await app(c)
  const file = join(OUT, `${label}-390.png`)
  await sideBySide(await page.screenshot(), ref.png, file)
  console.log(`  wrote ${file.slice(REPO.length + 1)}`)
  const hay = normalise(await page.evaluate(`(${haystackOf})(document.body)`))
  const missing = ref.words.filter((w) => !hay.includes(normalise(w.text))).map((w) => `${w.kind} “${w.text}”`)
  if (c.words === 'report') {
    if (missing.length) console.log(`  words not on the app yet (${c.why}):\n${missing.map((m) => `    · ${m}`).join('\n')}`)
  } else for (const m of missing) failures.push(`${label}: missing ${m}`)
  for (const p of await page.evaluate(`(${layoutProblems})()`)) failures.push(`${label}: ${p}`)
  await ctx.close()
}

await browser.close()
server.close()
if (unanswered.size) console.log(`\nthe sample had no answer for (404): ${[...unanswered].join(', ')}`)
if (failures.length) {
  console.log(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:\n${failures.map((f) => `  ✗ ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nthe words check and the layout check pass on every screen')
