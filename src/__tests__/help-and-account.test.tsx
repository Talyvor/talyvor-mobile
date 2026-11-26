import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { StyleSheet } from 'react-native'

import { palettes } from '../theme'

// B59.29 — the phone's Help and complaints, Close this account and Your data (the web's B59.28, on the phone): each form
// sends one request with its kind and message only, a complaint shows its reference, the list shows each request's state
// and Talyvor's answer, closing is refused naming every balance, and a finished copy of the data reaches the share sheet.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))

/** What was written to the phone and handed to the share sheet. */
const mockFiles: { written: Map<string, Uint8Array>; shared: { uri: string; mimeType?: string }[] } = { written: new Map(), shared: [] }
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string
    exists = false
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`
    }
    create() {}
    delete() {}
    write(bytes: Uint8Array) {
      mockFiles.written.set(this.uri, bytes)
    }
  },
}))
jest.mock('expo-sharing', () => ({
  shareAsync: async (uri: string, o: { mimeType?: string }) => void mockFiles.shared.push({ uri, mimeType: o.mimeType }),
}))

/** The web's strings, typed from suite 4fb65ba (apps/web/src/areas/lens/HelpAndAccount.tsx and PageLinks.tsx), and the
 * deletion card's from suite c7a0a86 (B57.139): the phone's screens are checked against these, not against their own copy. */
const WEB = {
  settings: [
    'Help and complaints',
    'Ask us something, or make a complaint',
    'Your data',
    'A copy of your data, or ask for it to be deleted',
    'Close this account',
    'What must be empty first, and asking to close',
  ],
  help: [
    'Ask us about your account, or tell us what went wrong. A person at Talyvor reads every message and answers on this page.',
    'A complaint gets a reference as soon as you send it. Quote it whenever you write to us about it.',
    'Write to us',
    'What is it?',
    'A question or a problem',
    'A complaint',
    'Your message',
    'Send',
    'What you sent',
  ],
  close: [
    'Before the account can close, every balance must be empty: the account’s own, each agent’s, and any money set aside. Move the money out first.',
    'A person at Talyvor closes the account and answers on this page. Only the account’s owner can ask.',
    'Ask to close',
    'Anything we should know (optional)',
    'Ask to close this account',
    'What you asked',
    'You have not asked to close this account.',
    'Anything you send appears here with what Talyvor answers.',
  ],
  data: [
    'Ask for a copy of this account’s data, or ask Talyvor to delete it. A person at Talyvor handles each request. Only the account’s owner can ask.',
    'A copy of your data',
    'A person at Talyvor prepares it. When it is ready, Download appears beside your request.',
    'Ask for a copy',
    'Delete your data',
    'Ask, and we delete it. Billing and ledger records, statements included, are kept as the law requires.',
    'Ask to delete your data',
    'What you asked',
  ],
}

type Req = { id: number; kind: string; state: string; reference: string; message: string; answer: string; filed_at: string; updated_at: string }

/** Lens behind the BFF; `calls` is every request the app made, `requests` what the workspace has sent. */
function mockBff({ requests = [] as Req[], closure, deletion, email = '' }: { requests?: Req[]; closure?: { status: number; body: unknown }; deletion?: { status: number; body?: unknown }; email?: string } = {}) {
  const calls: { method: string; path: string; body?: unknown; auth?: string }[] = []
  let next = 100
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, path, body, auth: (init.headers as Record<string, string> | undefined)?.Authorization })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_northwind', authenticated: true, user: { sub: 'p_1', email } })
      case 'POST /auth/account/delete':
        if (!deletion) break
        return deletion.status === 204 ? new Response(null, { status: 204 }) : json(deletion.body, deletion.status)
      case 'GET /api/workspace/name':
        return json({ id: 'ws_northwind', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'business', money_kind: 'fiat' })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/workspace/requests':
        return json({ requests })
      case 'POST /api/workspace/requests': {
        if (body.kind === 'account_closure' && closure) return json(closure.body, closure.status)
        const filed: Req = {
          id: next++,
          kind: body.kind,
          state: 'received',
          reference: body.kind === 'complaint' ? 'C-7KQ2-M4XD' : '',
          message: body.message,
          answer: '',
          filed_at: '2026-11-12T09:00:00Z',
          updated_at: '2026-11-12T09:00:00Z',
        }
        requests.unshift(filed)
        return json(filed, 201)
      }
      case 'GET /api/workspace/requests/7/export':
        return new Response('{"workspace":"ws_northwind"}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return calls
}

const posts = (calls: { method: string; path: string; body?: unknown; auth?: string }[]) => calls.filter((c) => c.method === 'POST' && c.path === '/api/workspace/requests').map((c) => c.body)

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockFiles.written.clear()
  mockFiles.shared.length = 0
})

test("Settings lists the three with the web's words, and each opens its screen", async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/settings' })
  expect(await screen.findByText('Help and your account')).toBeTruthy()
  for (const words of WEB.settings) expect(screen.getByText(words)).toBeTruthy()
  await fireEvent.press(screen.getByText('Your data'))
  expect(await screen.findByText('Ask for a copy')).toBeTruthy()
})

test("Help and complaints shows the web's words, sends a complaint with its kind and message only, and shows its reference", async () => {
  const calls = mockBff()
  await renderRouter('./src/app', { initialUrl: '/settings/help' })
  expect(await screen.findByText('Nothing sent yet.')).toBeTruthy()
  for (const words of WEB.help) expect(screen.getAllByText(words).length).toBeGreaterThan(0)

  await fireEvent.press(screen.getByRole('radio', { name: 'A complaint' }))
  await fireEvent.changeText(screen.getByLabelText('Your message'), 'My card was charged twice.')
  await fireEvent.press(screen.getByText('Send complaint'))

  expect(await screen.findByText('Complaint received')).toBeTruthy()
  expect(screen.getByText('Its reference is C-7KQ2-M4XD.')).toBeTruthy()
  expect(posts(calls)).toEqual([{ kind: 'complaint', message: 'My card was charged twice.' }])
  const row = await screen.findByTestId('request-100')
  expect(within(row).getByText('Complaint')).toBeTruthy()
  expect(within(row).getByText('C-7KQ2-M4XD')).toBeTruthy()
  expect(within(row).getByText('Received')).toBeTruthy()
})

test('the list shows each request with its state and Talyvor’s answer', async () => {
  mockBff({
    requests: [
      { id: 3, kind: 'support', state: 'done', reference: '', message: 'How do I add a payee?', answer: 'Open Payees and press Add.', filed_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T10:00:00Z' },
      { id: 2, kind: 'complaint', state: 'in_progress', reference: 'C-AB12-CD34', message: 'Late refund.', answer: '', filed_at: '2026-11-10T09:00:00Z', updated_at: '2026-11-11T09:00:00Z' },
    ],
  })
  await renderRouter('./src/app', { initialUrl: '/settings/help' })
  const done = await screen.findByTestId('request-3')
  expect(within(done).getByText('Question or problem')).toBeTruthy()
  expect(within(done).getByText('Done')).toBeTruthy()
  expect(within(done).getByText('Talyvor’s answer:', { exact: false })).toBeTruthy()
  expect(within(done).getByText('Open Payees and press Add.', { exact: false })).toBeTruthy()
  const open = screen.getByTestId('request-2')
  expect(within(open).getByText('In progress')).toBeTruthy()
  expect(within(open).getByText('Sent 10 November 2026', { exact: false })).toBeTruthy()
  expect(within(open).getByText('C-AB12-CD34')).toBeTruthy()
})

test('closing is refused while the account holds money, naming each balance', async () => {
  const calls = mockBff({ closure: { status: 409, body: { error: 'balances are not empty', code: 'balances_not_empty', balances: { GBP: 1250, USDC: 3_000_000 } } } })
  await renderRouter('./src/app', { initialUrl: '/settings/close' })
  expect(await screen.findByText('You have not asked to close this account.')).toBeTruthy()
  for (const words of WEB.close) expect(screen.getAllByText(words).length).toBeGreaterThan(0)

  await fireEvent.press(screen.getByText('Ask to close this account'))
  expect(await screen.findByText('This account still holds £12.50, 3.00 USDC. Move the money out, then ask again.')).toBeTruthy()
  expect(posts(calls)).toEqual([{ kind: 'account_closure', message: '' }])
})

// B52.47 — the web's Delete your account (suite B52.38, B57.209), typed from suite ae827d8 HelpAndAccount.tsx.
const DELETE_WORDS = {
  card: [
    'Delete your account',
    'Deletes every account you hold and signs you out everywhere: every browser, every phone and every connected assistant. It can’t be undone. Billing and ledger records, statements included, are kept as the law requires.',
  ],
  sheet: ['Delete your account?', 'Every account you hold is deleted, and every browser, phone and connected assistant is signed out. This can’t be undone.', 'Keep my account', 'Yes, delete my account'],
}

const deletes = (calls: { method: string; path: string; body?: unknown; auth?: string }[]) => calls.filter((c) => c.method === 'POST' && c.path === '/auth/account/delete')

test('Delete your account sends the typed email once on the session, then the phone forgets the session and its key and opens the first screen', async () => {
  const calls = mockBff({ deletion: { status: 204 }, email: 'ada@northwind.test' })
  mockStore.set('talyvor.device-key', 'dk_1')
  mockStore.set('talyvor.device-workspace', 'ws_northwind')
  await renderRouter('./src/app', { initialUrl: '/settings/close' })
  expect(await screen.findByText('You have not asked to close this account.')).toBeTruthy()
  for (const words of DELETE_WORDS.card) expect(screen.getAllByText(words).length).toBeGreaterThan(0)

  await fireEvent.press(screen.getByRole('button', { name: 'Delete your account' }))
  for (const words of DELETE_WORDS.sheet) expect(await screen.findByText(words)).toBeTruthy()
  const yes = screen.getByRole('button', { name: 'Yes, delete my account' })
  expect(yes.props.accessibilityState?.disabled).toBe(true)
  await fireEvent.changeText(await screen.findByLabelText('Type ada@northwind.test to confirm'), ' Ada@Northwind.test ')
  await fireEvent.press(screen.getByRole('button', { name: 'Yes, delete my account' }))

  expect(await screen.findByText('What’s your phone number?')).toBeTruthy()
  expect(deletes(calls)).toEqual([{ method: 'POST', path: '/auth/account/delete', body: { confirm: ' Ada@Northwind.test ' }, auth: 'Bearer session-1' }])
  expect(mockStore.has('talyvor.session')).toBe(false)
  expect(mockStore.has('talyvor.device-key')).toBe(false)
  expect(mockStore.has('talyvor.device-workspace')).toBe(false)
})

test('a refused deletion shows Lens’s sentence and keeps the person signed in', async () => {
  const sentence = 'This account still holds money: £12.50. Move it out, then delete your account.'
  const calls = mockBff({ deletion: { status: 409, body: { error: sentence } } })
  mockStore.set('talyvor.device-key', 'dk_1')
  await renderRouter('./src/app', { initialUrl: '/settings/close' })
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete your account' }))
  await fireEvent.changeText(await screen.findByLabelText('Type DELETE to confirm'), 'delete')
  await fireEvent.press(screen.getByRole('button', { name: 'Yes, delete my account' }))

  expect(await screen.findByText(sentence)).toBeTruthy()
  expect(deletes(calls).map((c) => c.body)).toEqual([{ confirm: 'delete' }])
  expect(mockStore.get('talyvor.session')).toContain('session-1')
  expect(mockStore.get('talyvor.device-key')).toBe('dk_1')
  expect(screen.getByText('Keep my account')).toBeTruthy()
})

// B57.226 — drawn as Pocket Live draws its close-account sheet (pocket-live SH.closeAcct): no tangerine edge, which only
// the approval sheet wears; the line under the question in ink-2; Keep my account in ink; the red button is .btn.danger,
// red on danger-50 with no outline, on the card as in the sheet.
test('Delete your account and its sheet are drawn as Pocket Live’s close-account sheet', async () => {
  mockBff()
  const c = palettes.light
  const look = (name: string) => StyleSheet.flatten(screen.getByRole('button', { name }).props.style)
  await renderRouter('./src/app', { initialUrl: '/settings/close' })
  expect(await screen.findByText('You have not asked to close this account.')).toBeTruthy()
  expect(look('Delete your account')).toMatchObject({ backgroundColor: c.danger50 })
  expect(look('Delete your account').borderWidth ?? 0).toBe(0)

  await fireEvent.press(screen.getByRole('button', { name: 'Delete your account' }))
  const sheet = await screen.findByTestId('delete-account-sheet')
  expect(StyleSheet.flatten(within(sheet).getByText(DELETE_WORDS.sheet[1]).props.style).color).toBe(c.ink2)
  expect(look('Keep my account')).toMatchObject({ backgroundColor: c.primary })
  expect(look('Yes, delete my account')).toMatchObject({ backgroundColor: c.danger50 })
  expect(look('Yes, delete my account').borderWidth ?? 0).toBe(0)
  type Node = { type?: unknown; props?: { style?: unknown }; parent?: Node | null; children?: (Node | string)[] }
  let root: Node = sheet as unknown as Node
  while (root.parent) root = root.parent
  const walk = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap((k) => (typeof k === 'string' ? [] : walk(k)))]
  const tangerine = walk(root).filter((n) => StyleSheet.flatten(n.props?.style as never)?.backgroundColor === c.tangerine)
  expect(tangerine).toHaveLength(0)
})

test('Your data asks for a copy and, once done, hands it to the share sheet; deletion is its own request', async () => {
  const calls = mockBff({
    requests: [{ id: 7, kind: 'data_export', state: 'done', reference: '', message: '', answer: '', filed_at: '2026-11-11T09:00:00Z', updated_at: '2026-11-12T08:00:00Z' }],
  })
  await renderRouter('./src/app', { initialUrl: '/settings/data' })
  expect(await screen.findByText('Download your data')).toBeTruthy()
  for (const words of WEB.data) expect(screen.getAllByText(words).length).toBeGreaterThan(0)

  await fireEvent.press(screen.getByText('Download your data'))
  await waitFor(() => expect(mockFiles.shared).toEqual([{ uri: 'file:///cache/talyvor-data.json', mimeType: 'application/json' }]))
  expect(new TextDecoder().decode(mockFiles.written.get('file:///cache/talyvor-data.json'))).toBe('{"workspace":"ws_northwind"}')

  await fireEvent.press(screen.getByText('Ask for a copy'))
  expect(await screen.findByText('When your copy is ready, Download appears on this page.')).toBeTruthy()
  await fireEvent.changeText(screen.getByLabelText('Anything we should know (optional)'), 'Delete everything you can.')
  await fireEvent.press(screen.getByText('Ask to delete your data'))
  expect(await screen.findByText('A person at Talyvor answers on this page.')).toBeTruthy()
  expect(posts(calls)).toEqual([
    { kind: 'data_export', message: '' },
    { kind: 'data_deletion', message: 'Delete everything you can.' },
  ])
})

// B57.140 — drawn in Pocket as the web's B57.139 draws them: each screen's heading line is its Settings row's line, what
// was sent comes before the form (p-chat's thread above where a message is written), and each sent row stands on its
// kind's tile.
test.each([
  ['/settings/help', 'support', 'Help and complaints', 'Ask us something, or make a complaint', 'Send'],
  ['/settings/close', 'account_closure', 'Close this account', 'What must be empty first, and asking to close', 'Ask to close this account'],
  ['/settings/data', 'data_deletion', 'Your data', 'A copy of your data, or ask for it to be deleted', 'Ask for a copy'],
])('%s draws its heading line, then what was sent, then the form', async (path, kind, heading, line, button) => {
  mockBff({ requests: [{ id: 5, kind, state: 'received', reference: '', message: '', answer: '', filed_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:00:00Z' }] })
  await renderRouter('./src/app', { initialUrl: path })
  const row = await screen.findByTestId('request-5')
  expect(within(row).getByTestId('request-5-tile')).toBeTruthy()
  expect(screen.getByRole('header', { name: heading })).toBeTruthy()
  // the screen in reading order: every testID and every string, as the tree draws them
  const order: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string') return void order.push(n)
    if (Array.isArray(n)) return n.forEach(walk)
    if (n && typeof n === 'object') {
      const node = n as { props?: { testID?: string }; children?: unknown }
      if (node.props?.testID) order.push(`#${node.props.testID}`)
      walk(node.children)
    }
  }
  walk(screen.toJSON())
  expect(order.indexOf(heading)).toBeLessThan(order.indexOf(line))
  expect(order.indexOf(line)).toBeLessThan(order.indexOf('#request-5'))
  expect(order.indexOf('#request-5')).toBeLessThan(order.lastIndexOf(button))
})
