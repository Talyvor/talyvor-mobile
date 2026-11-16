import * as ui from '@expo/ui/swift-ui'
import * as modifiers from '@expo/ui/swift-ui/modifiers'
import type { AgentApproval, AgentBook, PaymentRequest } from '@talyvor/bff-client'
import { renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

import { heldPayments } from '../live-activity.ios'
import { palettes } from '../theme'
import { ApprovalActivityLayout, type ApprovalActivityProps } from '../widgets/approval-activity'

// B57.76: the lock screen's Live Activity in Pocket. Each waiting payment shows "Waiting for you" by the app icon, the
// payee and its amount in the currency that pays it, dollars and euros symbol first and never LXC, who asked, and what
// the one tap does, in Figtree; the tap opens that request's sheet.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
jest.mock('../../modules/talyvor-keys', () => ({ isAvailable: () => true, sign: async () => 'signed', deleteKey: async () => undefined }))

const juno: AgentApproval = {
  id: 'apr_juno',
  agent_id: 'ag_juno',
  amount_ulxc: 4_480_000_000,
  model: '',
  payee: { kind: 'payee', id: 'py_lisbon', name: 'Lisbon Stay' },
  status: 'pending',
  created_at: '2026-11-16T08:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  paid_from: { kind: 'account', account_id: 'acc_eur', name: 'Euro account', currency: 'EUR', amount_minor: 41_200, balance_minor: 60_000 },
}
const scout: AgentApproval = {
  ...juno,
  id: 'apr_scout',
  agent_id: 'ag_scout',
  payee: { kind: 'payee', id: 'py_hosting', name: 'Acme Hosting' },
  paid_from: { kind: 'card', account_id: 'card_1', name: 'Scout’s card', currency: 'USD', amount_minor: 34_000, balance_minor: null },
}
const prepared = (id: string, agent_id?: string): PaymentRequest =>
  ({
    id,
    status: 'pending_approval',
    summary: '',
    totals: { GBP: 2500 },
    created_at: '2026-11-16T08:00:00Z',
    agent_id,
    items: [{ position: 1, payee_id: 'py_1', payee_name: 'Bolt Couriers', currency: 'GBP', amount_minor: 2500, reference: 'Nov', decision: 'needs_approval' }],
  }) as unknown as PaymentRequest
const book = { agents: [{ id: 'ag_juno', name: 'Juno' }, { id: 'ag_scout', name: 'Scout' }] } as unknown as AgentBook

test('each waiting payment carries its payee, its amount symbol first in the currency that pays it, who asked, and its link', () => {
  const held = heldPayments([prepared('preq_scout', 'ag_scout'), prepared('preq_company')], [juno, scout], book, 0.1)
  expect(held.map((h) => [h.url, h.props.title, h.props.amount, h.props.detail, h.props.hint])).toEqual([
    ['talyvor://approve/preq_scout', 'Bolt Couriers', '£25.00', 'Scout asks', 'Tap to approve with Face ID'],
    ['talyvor://approve/preq_company', 'Bolt Couriers', '£25.00', 'From the company’s account', 'Tap to approve with Face ID'],
    ['talyvor://approvals/apr_juno', 'Lisbon Stay', '€412.00', 'Juno asks', 'Tap to approve with Face ID'],
    ['talyvor://approvals/apr_scout', 'Acme Hosting', '$340.00', 'Scout asks', 'Tap to approve with Face ID'],
  ])
  expect(held.map((h) => h.props.amount).join(' ')).not.toMatch(/LXC/)
})

// What the widget runtime does with the layout: run its source with the SwiftUI components and modifiers in scope.
type Node = { type: unknown; props: Record<string, unknown> & { children?: unknown; modifiers?: Record<string, unknown>[] } }
function draw(props: ApprovalActivityProps, colorScheme: 'light' | 'dark') {
  const scope: Record<string, unknown> = { ...ui, ...modifiers, _jsx: (type: unknown, p: Node['props']) => ({ type, props: p }) }
  scope._jsxs = scope._jsx
  const layout = new Function(...Object.keys(scope), `return (${String(ApprovalActivityLayout)})`)(...Object.values(scope))
  return layout(props, { colorScheme }) as Record<string, Node>
}
const nodes = (n: unknown): Node[] =>
  !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n as Node, ...nodes((n as Node).props.children)]
const texts = (n: Node) => nodes(n).filter((x) => x.type === ui.Text).map((x) => String(x.props.children))
const modifier = (n: Node, type: string) => n.props.modifiers?.find((m) => m.$type === type)
const waiting: ApprovalActivityProps = { state: 'waiting', title: 'Lisbon Stay', amount: '€412.00', detail: 'Juno asks', hint: 'Tap to approve with Face ID', palette: palettes }

test('the lock screen draws the app icon, Waiting for you, the payee, the amount, who asked and the tap, in Figtree', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const { banner } = draw(waiting, scheme)
    const c = palettes[scheme]
    expect(texts(banner)).toEqual(['Waiting for you', 'Lisbon Stay', '€412.00', 'Juno asks', 'Tap to approve with Face ID'])
    // The app icon leads the eyebrow, and nothing in it is a button: the whole activity is the one tap target.
    expect(nodes(banner).find((x) => x.type === ui.Image)?.props.assetName).toBe('TalyvorAppIcon')
    expect(nodes(banner).some((x) => x.type === ui.Button || x.type === ui.Link)).toBe(false)
    expect(modifier(banner, 'background')).toMatchObject({ style: { color: c.page } })
    const amount = nodes(banner).find((x) => x.props.children === '€412.00')!
    expect(modifier(amount, 'font')).toMatchObject({ family: 'Figtree-Bold' })
    expect(modifier(amount, 'monospacedDigit')).toBeTruthy()
    const eyebrow = nodes(banner).find((x) => x.props.children === 'Waiting for you')!
    expect(modifier(eyebrow, 'foregroundStyle')).toMatchObject({ style: { color: c.tangerineInk } })
    for (const t of nodes(banner).filter((x) => x.type === ui.Text)) expect(String(modifier(t, 'font')?.family)).toMatch(/^Figtree-/)
  }
  // The Dynamic Island is black whatever the phone is set to, so it draws in the dark palette.
  const island = draw(waiting, 'light')
  expect(modifier(island.compactTrailing, 'foregroundStyle')).toMatchObject({ style: { color: palettes.dark.ink } })
  expect(texts(island.compactTrailing)).toEqual(['€412.00'])
  expect(island.compactLeading.props.assetName).toBe('TalyvorAppIcon')
})

test('approved, declined and expired end in those words, with no tap left to make', () => {
  for (const [state, word] of [
    ['approved', 'Approved'],
    ['declined', 'Declined'],
    ['expired', 'Expired'],
  ] as const) {
    const { banner } = draw({ ...waiting, state }, 'dark')
    expect(texts(banner)).toEqual([word, 'Lisbon Stay', '€412.00', 'Juno asks'])
  }
})

test('a tap on the activity opens the app on that request’s approval sheet', async () => {
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dk_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
  const routes: Record<string, unknown> = {
    'GET /auth/me': { workspace_id: 'ws_1' },
    'GET /api/lxc/topup-options': { usd_per_lxc: 0.1, min_usd_cents: 1000 },
    'GET /api/agents': { workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_juno', name: 'Juno', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] },
    'GET /api/agents/approvals': { approvals: [juno] },
    'GET /api/wallets/capabilities': { capabilities: [] },
  }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const route = routes[`${init.method ?? 'GET'} ${url.replace('https://bff.test', '').split('?')[0]}`]
    return new Response(JSON.stringify(route ?? { error: 'no' }), { status: route ? 200 : 404 })
  }) as unknown as typeof fetch

  const [tap] = heldPayments([], [juno], book, 0.1)
  await renderRouter('./src/app', { initialUrl: tap.url.replace('talyvor://', '/') })
  await waitFor(() => expect(screen.getByTestId('approval-sheet')).toBeTruthy())
  const sheet = within(screen.getByTestId('approval-sheet'))
  expect(sheet.getByText('€412.00')).toBeTruthy()
  expect(sheet.getByText('Lisbon Stay')).toBeTruthy()
  expect(sheet.getByRole('button', { name: 'Approve with Face ID' })).toBeTruthy()
})
