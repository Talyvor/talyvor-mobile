/// <reference types="node" />
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import * as ScreenCapture from 'expo-screen-capture'

// B50.10 — the phone app's security checklist: storage, links, the bundle, TLS, the app switcher and the dependencies.

jest.setTimeout(240_000)

const root = join(__dirname, '../..')
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a plain Node script: node scripts/check-bundle.js dist
const { scan } = require(join(root, 'scripts/check-bundle.js')) as { scan: (dir: string) => string[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a plain Node script: node scripts/check-audit.js
const audit = require(join(root, 'scripts/check-audit.js')) as {
  allowed: (file?: string) => string[]
  check: (report: unknown, allow: string[]) => string[]
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : sources(p)
    return /\.(ts|tsx|js)$/.test(f) ? [p] : []
  })
}
const appSources = [...sources(join(root, 'src')), ...sources(join(root, 'packages/bff-client/src')), ...sources(join(root, 'modules/talyvor-keys'))]

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))

const request = {
  id: 'pr_1',
  agent_id: '',
  client: 'chat',
  summary: 'October hosting',
  status: 'pending_approval',
  totals: { GBP: 2500 },
  items: [{ position: 0, payee_id: 'py_1', payee_name: 'Acme Hosting', amount_minor: 2500, currency: 'GBP', reference: 'Oct', decision: 'needs_approval' }],
  created_at: '2026-10-28T08:00:00Z',
}

/** The BFF; records every call so a test can prove a link wrote nothing. */
function mockBff() {
  const calls: { method: string; path: string }[] = []
  const routes: Record<string, unknown> = {
    'POST /auth/phone/start': { expires_at: '2099-01-01T00:00:00Z', sandbox: true, sandbox_code: '482913' },
    'POST /auth/phone/finish': { check: 'chk_1', has_person: true, expires_at: '2099-01-01T00:00:00Z' },
    'POST /auth/phone/signin': { signed_in: true, signup_unfinished: false, account_id: 'ws_1', token: 'session-1', expires_at: '2099-01-01T00:00:00Z' },
    'GET /api/agents': { workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] },
    'GET /api/agents/approvals': { approvals: [{ id: 'apr_1', agent_id: 'ag_1', amount_ulxc: 2_000_000, model: '', payee: { kind: 'listing', id: 'l_1', name: 'GPU hour' }, status: 'pending', created_at: '2026-10-28T08:00:00Z' }] },
    'GET /api/money/payment-requests?status=pending_approval': { requests: [request] },
    'GET /api/money/payment-requests/pr_1': request,
    'GET /api/money/payees': { payees: [] },
    'GET /api/money/payments': { payments: [] },
  }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const path = url.replace('https://bff.test', '')
    calls.push({ method, path })
    const body = routes[`${method} ${path}`]
    return new Response(JSON.stringify(body ?? { error: 'no' }), { status: body ? 200 : 404 })
  }) as unknown as typeof fetch
  return calls
}

const signedIn = () => mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))

beforeEach(() => {
  mockStore.clear()
  jest.clearAllMocks()
})

describe('storage', () => {
  test('the session goes only to the platform keystore; nothing uses AsyncStorage', async () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => /async-storage/i.test(d))).toEqual([])
    expect(appSources.filter((f) => /async-storage|AsyncStorage/.test(readFileSync(f, 'utf8')))).toEqual([])

    mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    await fireEvent.changeText(await screen.findByLabelText('Phone number'), '7700 900456')
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await fireEvent.changeText(await screen.findByLabelText('Code'), '482913')
    await screen.findByText('Enter your passcode')
    for (const d of '418263') await fireEvent.press(screen.getByRole('button', { name: d }))
    await waitFor(() => expect(JSON.parse(mockStore.get('talyvor.session')!).token).toBe('session-1'))
  })

  test('no log line carries a token, a session, a key or a signature', () => {
    const leaks = appSources.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/console\.\w+\(([^)]*)\)/g)].filter((m) => /token|session|secret|signature|assertion|key\b/i.test(m[1])).map((m) => `${f}: ${m[0]}`),
    )
    expect(leaks).toEqual([])
  })
})

describe('links', () => {
  // Every talyvor:// address that names an action. Opening one shows the screen; nothing is written until the person acts.
  test.each([
    ['/pause-all', 'Pause every agent?'],
    ['/bills?pay=1', /Approve 1 payment with/],
    ['/approve/pr_1?pay=1', /Approve 1 payment with/],
    ['/approvals/apr_1', 'Researcher is waiting for you'],
    ['/widget?do=pause&agent=ag_1&t=forged', 'This link did not come from your Talyvor widget, so nothing changed.'],
  ])('%s writes nothing on its own', async (url, shown) => {
    signedIn()
    const calls = mockBff()
    await renderRouter('./src/app', { initialUrl: url })
    expect(await screen.findByText(shown)).toBeTruthy()
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
  })

  test('a link straight to a payment lands on its approval card, whose only way to approve is the biometric step', async () => {
    signedIn()
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/bills?pay=1' })
    expect(await screen.findByText(/Approve 1 payment with/)).toBeTruthy()
    // approveBatch is the one approver (src/approve-batch.ts); it signs with the device key before it asks Lens.
    const approver = appSources.filter((f) => /approveRequest\(/.test(readFileSync(f, 'utf8')) && !f.includes('bff-client'))
    expect(approver.map((f) => f.replace(root, ''))).toEqual(['/src/approve-batch.ts'])
    expect(readFileSync(join(root, 'src/approve-batch.ts'), 'utf8')).toMatch(/await signStatement\([^]*return client\.approveRequest\(requestId, prepared\.statement, assertion\)/)
  })

  test('no link can send the person to another address: nothing opens a URL it was given', () => {
    const opens = appSources.filter((f) => /Linking\.openURL|openBrowserAsync|openAuthSessionAsync|\+native-intent/.test(readFileSync(f, 'utf8')))
    // B61.39 — Help's "Send to our team" opens the phone's mail app, always to COMPANY_CONTACT. B65.3 — the identity step
    // opens our privacy notice on our own address, and the identity check's link only when it is Persona's own page.
    // B48.20 — an agent's wallet opens a transaction only on one of its two explorers, built from a checked hash.
    expect(opens.map((f) => f.replace(root, ''))).toEqual(['/src/components/agent-wallet.tsx', '/src/components/identity-checks.tsx', '/src/help-words.ts'])
    const wallet = readFileSync(join(root, 'src/components/agent-wallet.tsx'), 'utf8')
    expect(wallet.match(/(Linking\.openURL|openBrowserAsync|openAuthSessionAsync)\([^)]*\)/g)).toEqual(['Linking.openURL(url)'])
    expect(wallet).toContain("const EXPLORERS: Record<string, string> = { base: 'https://basescan.org', 'base-sepolia': 'https://sepolia.basescan.org' }")
    expect(wallet).toContain('Object.hasOwn(EXPLORERS, network) && /^0x[0-9a-fA-F]{64}$/.test(tx) ? `${EXPLORERS[network]}/tx/${tx}` : null')
    expect(wallet).toMatch(/const openExplorer = \(url: string \| null\) =>/)
    expect(wallet.match(/openExplorer\([^)]*\)/g)).toEqual(['openExplorer(explorerUrl(s.network, s.tx_hash ?? \'\')', 'openExplorer(link)'])
    const identity = readFileSync(join(root, 'src/components/identity-checks.tsx'), 'utf8')
    expect(identity.match(/(Linking\.openURL|openBrowserAsync|openAuthSessionAsync)\([^)]*\)/g)).toEqual([
      'openBrowserAsync(`${config.bffUrl}/privacy`)',
      'openAuthSessionAsync(partner, BACK_LINK)',
    ])
    expect(identity).toContain('const PARTNER_PAGE = /^https:\\/\\/([a-z0-9-]+\\.)*withpersona\\.com(\\/|\\?|$)/i')
    expect(identity).toMatch(/next\.link && PARTNER_PAGE\.test\(next\.link\) \? next\.link : undefined/)
    const help = readFileSync(join(root, 'src/help-words.ts'), 'utf8')
    expect(help.match(/Linking\.openURL\([^)]*\)/g)).toEqual(['Linking.openURL(helpMailto(question)'])
    expect(help).toMatch(/helpMailto = \(question: string\) =>\s+`mailto:\$\{COMPANY_CONTACT\}\?subject=\$\{encodeURIComponent\('Help with Talyvor'\)\}&body=\$\{encodeURIComponent\(question\)\}`/)
    expect(help).toContain("export const COMPANY_CONTACT = 'hello@talyvor.com'")
    expect(readdirSync(join(root, 'src/app')).filter((f) => f.startsWith('+native-intent'))).toEqual([])
  })
})

describe('the bundle', () => {
  test('the scanner catches a planted key or internal address and passes a clean one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'))
    writeFileSync(join(dir, 'clean.js'), 'fetch("https://app.talyvor.com/api"); const dev = "http://localhost:8081"')
    expect(scan(dir)).toEqual([])
    for (const planted of ['sk_live_' + 'a'.repeat(24), 'sk-ant-' + 'b'.repeat(30), 'AKIA' + 'C'.repeat(16), 'http://lens.talyvor.internal:8080', 'http://10.0.0.7/', 'http://localhost:4000']) {
      const d = mkdtempSync(join(tmpdir(), 'bundle-'))
      writeFileSync(join(d, 'entry.hbc'), `xx${planted}xx`)
      expect(scan(d)).toHaveLength(1)
    }
  })

  test('the exported app carries no secret and no internal address', () => {
    const out = mkdtempSync(join(tmpdir(), 'export-'))
    // B58.11: a voice key left in the build's environment must not reach the app; the phone asks the BFF for it.
    const planted = 'planted-voice-key-' + 'Q'.repeat(24)
    execFileSync('npx', ['expo', 'export', '--platform', 'android', '--output-dir', out], {
      cwd: root,
      stdio: 'ignore',
      env: { ...process.env, EXPO_PUBLIC_PICOVOICE_ACCESS_KEY: planted },
    })
    expect(scan(out)).toEqual([])
    const all = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? all(join(dir, f)) : [join(dir, f)]))
    expect(all(out).filter((f) => readFileSync(f, 'latin1').includes(planted))).toEqual([])
  })

  test('only public settings are built in', () => {
    const names = new Set(appSources.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/EXPO_PUBLIC_\w+/g)].map((m) => m[0])))
    // Each is safe to ship in the app: the BFF's address, the wake word's file, and the test key's flag,
    // which a release build refuses. No vendor key: "Hey Taly"'s Picovoice key comes from the BFF after sign-in (B58.11).
    expect([...names].sort()).toEqual(['EXPO_PUBLIC_BFF_URL', 'EXPO_PUBLIC_HEY_TALY_KEYWORD', 'EXPO_PUBLIC_TALYVOR_TEST_KEYS'])
  })
})

describe('TLS only', () => {
  test('the native projects allow no cleartext traffic', () => {
    const exp = JSON.parse(execFileSync('npx', ['expo', 'config', '--type', 'introspect', '--json'], { cwd: root, encoding: 'utf8' }))
    const { android, ios } = exp._internal.modResults
    expect(android.manifest.manifest.application[0].$['android:usesCleartextTraffic']).toBe('false')
    expect(ios.infoPlist.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false })
  })

  test('a release build refuses an http:// BFF', () => {
    const real = jest.requireActual<typeof import('../config')>
    const g = globalThis as unknown as { __DEV__: boolean }
    const dev = g.__DEV__
    process.env.EXPO_PUBLIC_BFF_URL = 'http://app.talyvor.com'
    try {
      g.__DEV__ = false
      jest.isolateModules(() => expect(() => real('../config')).toThrow(/https/))
      process.env.EXPO_PUBLIC_BFF_URL = 'https://app.talyvor.com'
      jest.isolateModules(() => expect(real('../config').config.bffUrl).toBe('https://app.talyvor.com'))
    } finally {
      g.__DEV__ = dev
      delete process.env.EXPO_PUBLIC_BFF_URL
    }
  })
})

describe('the test key', () => {
  // B57.130 — the web export's software key is for a development build: a release build with the flag set does not start.
  test('a release build refuses the software test key, and loads without it when the flag is unset', () => {
    const g = globalThis as unknown as { __DEV__: boolean }
    const dev = g.__DEV__
    process.env.EXPO_PUBLIC_TALYVOR_TEST_KEYS = '1'
    try {
      g.__DEV__ = false
      jest.isolateModules(() => expect(() => jest.requireActual('../../modules/talyvor-keys')).toThrow(/release build/))
      delete process.env.EXPO_PUBLIC_TALYVOR_TEST_KEYS
      jest.isolateModules(() => expect(jest.requireActual('../../modules/talyvor-keys').default).toBeNull())
    } finally {
      g.__DEV__ = dev
      delete process.env.EXPO_PUBLIC_TALYVOR_TEST_KEYS
    }
  })
})

describe('the app switcher', () => {
  test('signed in, the app is hidden from the app switcher and screen capture', async () => {
    signedIn()
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/pay' })
    await waitFor(() => expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('signed-in'))
    expect(ScreenCapture.enableAppSwitcherProtectionAsync).toHaveBeenCalledWith(1)
  })

  test('not signed in, nothing is hidden', async () => {
    mockBff()
    await renderRouter('./src/app', { initialUrl: '/' })
    await screen.findByLabelText('Phone number')
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled()
  })
})

describe('dependencies', () => {
  // deepmerge (low, every version, no fix) is only in Expo's and Jest's config loaders at build time, merging our own files.
  // minimatch's globparts ReDoS (GHSA-g3hv-75wg-m249) is excepted only for the 3.x copies under eslint 9, its plugins and
  // jest's test-exclude: they call minimatch as a function, which 11 no longer exports, and they only match our own lint and
  // test globs. package.json's overrides move every other minimatch and glob to the patched major. The advisories in
  // scripts/audit-allow.txt have no fix to take.
  test('npm audit finds nothing moderate or worse', () => {
    const { stdout } = spawnSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8' })
    const found: string[] = []
    for (const v of Object.values(JSON.parse(stdout).vulnerabilities ?? {}) as { severity: string; nodes: string[]; via: unknown[] }[]) {
      if (v.severity === 'low' || v.severity === 'info') continue
      for (const a of v.via) {
        if (typeof a !== 'object') continue
        const { name, url } = a as { name: string; url: string }
        const excepted = (url.endsWith('GHSA-g3hv-75wg-m249') &&
          v.nodes.every((n) => JSON.parse(readFileSync(join(root, n, 'package.json'), 'utf8')).version.startsWith('3.'))) ||
          audit.allowed().some((g) => url.endsWith(g))
        if (!excepted) found.push(`${name} ${url}`)
      }
    }
    expect(found).toEqual([])
  })

  // B66.2 — CI's audit (node scripts/check-audit.js) lets through exactly the advisories in scripts/audit-allow.txt.
  const advisory = (name: string, ghsa: string, severity = 'high') =>
    ({ name, severity, url: `https://github.com/advisories/${ghsa}` })
  const report = (...via: (object | string)[]) => ({ vulnerabilities: { picomatch: { severity: 'high', via, nodes: [] } } })
  const picomatch = advisory('picomatch', 'GHSA-fc5q-39xc-vjpf')

  test('the allowed list is picomatch and nothing else', () => {
    expect(audit.allowed()).toEqual(['GHSA-fc5q-39xc-vjpf'])
    expect(audit.check(report(picomatch, 'micromatch'), audit.allowed())).toEqual([])
  })

  test('a second high or critical advisory fails the audit', () => {
    const other = advisory('picomatch', 'GHSA-aaaa-bbbb-cccc', 'critical')
    expect(audit.check(report(picomatch, other), audit.allowed())).toEqual([
      'picomatch critical https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    ])
    expect(audit.check(report(advisory('picomatch', 'GHSA-aaaa-bbbb-cccc', 'moderate')), audit.allowed())).toEqual([])
  })

  test('without its line, picomatch fails the audit', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'audit-allow-')), 'audit-allow.txt')
    writeFileSync(file, readFileSync(join(root, 'scripts/audit-allow.txt'), 'utf8').replace(/^GHSA-fc5q-39xc-vjpf\n/m, ''))
    expect(audit.check(report(picomatch), audit.allowed(file))).toEqual([
      'picomatch high https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
    ])
  })

  test('a report that is not an audit fails it', () => {
    expect(() => audit.check({ error: { code: 'ENOTFOUND' } }, audit.allowed())).toThrow('not an npm audit report')
  })
})
