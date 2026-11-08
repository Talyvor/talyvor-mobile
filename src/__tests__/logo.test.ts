import { spawnSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// B57.80 — the chosen logo (Nick, 4 Nov 2026) is the phone's only logo: every file is the kit's, at its size.

const root = join(__dirname, '../..')
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo
const plugin = (name: string) => app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === name)?.[1]

// A PNG's width and height sit in its IHDR chunk, bytes 16 to 24.
const size = (rel: string) => {
  const png = readFileSync(join(root, rel))
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

test('every phone size exists and app.json points at it', () => {
  expect(size(app.icon)).toEqual([1024, 1024])
  expect(size(app.android.adaptiveIcon.foregroundImage)).toEqual([432, 432])
  expect(size(app.android.adaptiveIcon.backgroundImage)).toEqual([432, 432])
  expect(size(app.web.favicon)).toEqual([32, 32])
  expect(plugin('expo-splash-screen')).toMatchObject({ backgroundColor: '#111216', image: './assets/logo/talyvor-symbol-on-dark-1024.png' })
  expect(size(plugin('expo-splash-screen').image)).toEqual([1024, 737])
  expect(app.plugins).toContain('./plugins/with-widget-symbol')
  for (const f of ['talyvor-symbol-small-on-dark-192', 'talyvor-symbol-small-on-light-192']) expect(size(`assets/logo/${f}.png`)).toEqual([192, 138])
  for (const f of ['talyvor-logo-small-on-dark-480', 'talyvor-logo-small-on-light-480']) expect(size(`assets/logo/${f}.png`)).toEqual([480, 153])
})

test("today's logo files are gone, and nothing points at them", () => {
  const old = ['app-icon-1024', 'icon-maskable-512', 'favicon-32', 'talyvor-mark-flat-dark', 'talyvor-logo-dark-notag', 'talyvor-logo-light-notag']
  for (const f of old) expect(existsSync(join(root, `assets/images/${f}.png`))).toBe(false)
  // app-icon-1024 and favicon-32 keep their names in assets/logo, so the folder catches them.
  const pattern = ['assets/images/', ...old.filter((f) => !['app-icon-1024', 'favicon-32'].includes(f))].join('|')
  const hits = spawnSync('git', ['grep', '-n', '-E', pattern, '--', '.', ':!src/__tests__/logo.test.ts'], { cwd: root, encoding: 'utf8' }).stdout
  expect(hits).toBe('')
})
