import { renderRouter, screen } from 'expo-router/testing-library'

// B59.11 — each type of account and each kind of money shows only what it has on the phone, with the web's words
// (talyvor-suite B59.10, SPEC 3.3 and 3.4): Home, Pay, a payee, an agent, Statement and Settings are rendered for each of
// the six and fail if a hidden element is present. Hidden means not rendered.

jest.setTimeout(60_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
jest.mock('../../modules/talyvor-keys', () => ({ isAvailable: () => true, sign: async () => '', deleteKey: async () => undefined }))

/** The web's strings, typed from suite e24f282 (apps/web/src/areas/lens/agentBankApi.ts and Pay.tsx): the phone is
 * checked against these, not against its own copy. */
const WEB = {
  typeLabel: { business: 'Business', personal: 'Personal' },
  kindLabel: { fiat: 'Fiat only', stablecoin: 'Stablecoin and crypto only', hybrid: 'Hybrid' },
  kindLine: {
    fiat: 'Your agents pay ordinary bills with cards and bank transfers.',
    stablecoin: 'Your agents work on chain.',
    hybrid: 'Both side by side, under one set of rules.',
  },
  chip: { business: { fiat: 'Business · Fiat', stablecoin: 'Business · Stablecoin', hybrid: 'Business · Hybrid' }, personal: { fiat: 'Personal · Fiat', stablecoin: 'Personal · Stablecoin', hybrid: 'Personal · Hybrid' } },
  agents: { business: 'Your team’s agents', personal: 'Your agents' },
  owner: { business: 'The company', personal: 'Your account' },
  cardTiers: { business: ['Team', 'Business', 'Enterprise'], personal: ['Daily', 'Premium', 'Platinum'] },
  typeFixed: 'The type can’t be changed. You can hold several accounts and switch between them.',
  // The web's Pay links "Agent Wallets"; the words around the link are these.
  payOnChain: 'Your agents work on chain: each agent’s wallet address is on Agent Wallets.',
} as const

type Type = 'business' | 'personal'
type Kind = 'fiat' | 'stablecoin' | 'hybrid'

const agents = [{ id: 'ag_1', name: 'Research', balance_ulxc: 5_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }]

/** Lens behind the BFF, for a workspace of this type and kind. */
function mockBff(account_type: Type, money_kind: Kind) {
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path] = url.replace('https://bff.test', '').split('?')
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    switch (`${init.method ?? 'GET'} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type, money_kind })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 5_000_000, allocated_ulxc: 5_000_000, unallocated_ulxc: 0, spent_ulxc: 0, agents })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/agents/ag_1/rules':
        return json({ max_per_request_ulxc: 1_000_000, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'UTC' })
      case 'GET /api/agents/statement':
        return json({ from: '2026-11-01', to: '2026-12-01', accounts: [{ account: 'agent:ag_1', opening_ulxc: 0, in_ulxc: 5_000_000, out_ulxc: 0, closing_ulxc: 5_000_000 }], lines: [] })
      case 'GET /api/money/payees':
        return json({ payees: [{ id: 'py_1', name: 'Acme Hosting', country: 'GB', needs_confirmation: false, created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/money/payments':
        return json({ payments: [] })
      case 'GET /api/money/accounts':
        // Lens names the owner's account as a company's whatever the type; the phone names it by the type.
        return json({ accounts: [{ id: 'acc_gbp', currency: 'GBP', purpose: 'company', status: 'open', name: 'The company · GBP', balance_minor: 100_000 }] })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
  }) as unknown as typeof fetch
}

/** Every word the screen draws, and every accessibility label. */
function drawn(): string {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (typeof n === 'string') out.push(n)
    else if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === 'object') {
      const label = (n as { props?: { accessibilityLabel?: unknown } }).props?.accessibilityLabel
      if (typeof label === 'string') out.push(label)
      walk((n as { children?: unknown }).children)
    }
  }
  walk(screen.toJSON())
  return out.join('\n')
}

/** What each type and kind must never draw, on any screen. */
function hidden(type: Type, kind: Kind): RegExp[] {
  const out: RegExp[] = []
  // Bank transfers in and out.
  if (kind === 'stablecoin') out.push(/Saved payees/, /Acme Hosting/, /Payees are added/, /bank/i)
  // Wallet addresses, on-chain send and receive.
  if (kind === 'fiat') out.push(/on chain/i, /wallet address/i, /Stablecoin/)
  // Convert between the two sides, and Instant transfer.
  if (kind !== 'hybrid') out.push(/Convert/i, /Instant transfer/i)
  // Team, roles, second approver and payout batches; company words.
  if (type === 'personal') out.push(/team/i, /company/i, /Members/, /second approver/i, /payout/i, /Business/)
  else out.push(/^Your agents$/m, /Your account/, /Personal/)
  return out
}

const COMBINATIONS = (['personal', 'business'] as const).flatMap((t) => (['fiat', 'stablecoin', 'hybrid'] as const).map((k) => [t, k] as const))

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
})

test.each(COMBINATIONS)('%s and %s: Home, Pay, a payee, an agent, Statement and Settings show only what it has', async (type, kind) => {
  mockBff(type, kind)
  const nothingHidden = () => {
    const words = drawn()
    for (const h of hidden(type, kind)) expect([h, words.match(h)?.[0]]).toEqual([h, undefined])
  }

  await renderRouter('./src/app', { initialUrl: '/' })
  expect(await screen.findByText(WEB.agents[type])).toBeTruthy()
  nothingHidden()

  await renderRouter('./src/app', { initialUrl: '/pay' })
  if (kind === 'stablecoin') expect(await screen.findByText(WEB.payOnChain)).toBeTruthy()
  else {
    expect(await screen.findByText('Acme Hosting')).toBeTruthy()
    expect(screen.queryByText(WEB.payOnChain)).toBeNull()
  }
  nothingHidden()

  if (kind !== 'stablecoin') {
    await renderRouter('./src/app', { initialUrl: '/payees/py_1' })
    expect((await screen.findAllByText(`${WEB.owner[type]} · GBP`)).length).toBeGreaterThan(0)
    nothingHidden()
  }

  await renderRouter('./src/app', { initialUrl: '/agents/ag_1' })
  expect(await screen.findByText('Rules')).toBeTruthy()
  nothingHidden()

  await renderRouter('./src/app', { initialUrl: '/statement' })
  expect(await screen.findByText(/^This month: /)).toBeTruthy()
  nothingHidden()

  await renderRouter('./src/app', { initialUrl: '/settings' })
  expect(await screen.findByText(WEB.chip[type][kind])).toBeTruthy()
  expect(screen.getByText(WEB.kindLabel[kind])).toBeTruthy()
  expect(screen.getByText(WEB.kindLine[kind])).toBeTruthy()
  expect(screen.getByText(WEB.typeLabel[type])).toBeTruthy()
  expect(screen.getByText(WEB.typeFixed)).toBeTruthy()
  nothingHidden()
})

test("the phone's words for each type and kind are the web's", () => {
  const phone = jest.requireActual<typeof import('../account')>('../account')
  expect(phone.TYPE_LABEL).toEqual(WEB.typeLabel)
  expect(phone.KIND_LABEL).toEqual(WEB.kindLabel)
  expect(phone.KIND_LINE).toEqual(WEB.kindLine)
  expect(phone.TYPE_FIXED).toBe(WEB.typeFixed)
  expect(phone.PAY_ON_CHAIN).toBe(WEB.payOnChain)
  for (const [type, kind] of COMBINATIONS) {
    const s = phone.shows({ account_type: type, money_kind: kind })
    expect(phone.accountChip({ account_type: type, money_kind: kind })).toBe(WEB.chip[type][kind])
    expect([s.agents, s.owner, s.cardTiers]).toEqual([WEB.agents[type], WEB.owner[type], WEB.cardTiers[type]])
    expect([s.bankTransfers, s.onChain, s.convert, s.instantTransfer]).toEqual([kind !== 'stablecoin', kind !== 'fiat', kind === 'hybrid', kind === 'hybrid'])
    expect([s.team, s.payoutBatches]).toEqual([type === 'business', type === 'business'])
  }
})
