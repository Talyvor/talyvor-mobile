import type { AgentSummary } from '@talyvor/bff-client'

import { type AgentData, AgentView } from '../components/agent'
import { pressEverything } from '../testing/press-everything'

// B57.70 — pressEverything on an agent's screen, running and paused, with this phone's key on and off.

jest.setTimeout(30_000)

const mockGo = { said: (_: string) => undefined as void }
const mockClient = {
  capabilities: async () => ({ capabilities: [] }),
  // B59.20: a Hybrid account, so the rules carry "Can use Instant transfer".
  account: async () => ({ workspace_id: 'ws_1', account_type: 'business', money_kind: 'hybrid' }),
  rulesChallenge: async () => ({ looser: false, changes: [], allow_credentials: null }),
  setRules: async () => mockGo.said('rules saved'),
  // B61.85: Add money and Take back read the accounts when their sheet opens.
  moneyAccounts: async () => ({ accounts: [] }),
}
jest.mock('../session', () => ({
  useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }),
}))
jest.mock('expo-router', () => ({
  router: { push: (to: unknown) => mockGo.said(JSON.stringify(to)) },
}))
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }))
jest.mock('../widget-sync', () => ({
  setPinned: async () => mockGo.said('pinned'),
  syncWidget: async () => undefined,
}))
jest.mock('../keys', () => ({
  ...jest.requireActual('../keys'),
  phoneKey: async () => null,
  resumeWithThisPhone: async () => {
    mockGo.said('signed resume')
    return null
  },
}))

const summary = (paused: boolean): AgentSummary => ({
  as_of: '2026-10-22T09:30:00Z',
  agent: {
    id: 'agt_research',
    name: 'Research',
    balance_ulxc: 16_500_000_000,
    spent_ulxc: 0,
    created_at: '2026-09-14T09:00:00Z',
    paused_at: paused ? '2026-10-21T17:00:00Z' : undefined,
  },
  month: {
    start: '2026-10-01T00:00:00Z',
    end: '2026-11-01T00:00:00Z',
    spent_ulxc: 12_400_000_000,
    forecast_ulxc: 0,
    monthly_limit_ulxc: 0,
  },
  approvals: [
    {
      id: 'apr_acme',
      agent_id: 'agt_research',
      amount_ulxc: 3_400_000_000,
      model: '',
      payee: { kind: 'outside', id: 'py_acme', name: 'Acme Hosting' },
      status: 'pending',
      created_at: '2026-10-22T08:17:00Z',
    },
  ],
  card: { status: 'active' },
  currency_accounts: [],
})
const rules = {
  max_per_request_ulxc: 10_000_000_000,
  daily_limit_ulxc: 0,
  monthly_limit_ulxc: 0,
  approval_above_ulxc: 0,
  allowed_models: null,
  allowed_providers: null,
  active_from: '',
  active_until: '',
  timezone: 'Europe/London',
}

test.each([
  ['running', false, true, 8],
  ['paused, this phone signing', true, true, 8],
  ['paused, this phone not signing', true, false, 8],
])('an agent %s: every button and the switch does something', async (_, paused, signs, pressed) => {
  const data: AgentData = {
    summary: summary(paused),
    rules,
    pinned: false,
    signs,
  }
  const report = await pressEverything((said) => {
    mockGo.said = said
    return <AgentView data={data} onChanged={() => said('changed')} />
  })
  expect(report.dead).toEqual([])
  // Review; Add money, Take back, Pause or Resume and Rules (B61.85); its card's row, the pin switch and Statement. Can
  // use Instant transfer is in the Rules sheet now.
  expect(report.pressed).toBe(pressed)
})
