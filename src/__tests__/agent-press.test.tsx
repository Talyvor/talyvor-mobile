import type { AgentSummary } from '@talyvor/bff-client'

import { type AgentData, AgentView } from '../components/agent'
import { pressEverything } from '../testing/press-everything'

// B57.70 — pressEverything on an agent's screen, running and paused, with this phone's key on and off.

jest.setTimeout(30_000)

const mockGo = { said: (_: string) => undefined as void }
const mockClient = { capabilities: async () => ({ capabilities: [] }) }
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
  ['running', false, true, 4],
  ['paused, this phone signing', true, true, 4],
  ['paused, this phone not signing', true, false, 4],
])('an agent %s: every button and the switch does something', async (_, paused, signs, pressed) => {
  const data: AgentData = {
    summary: summary(paused),
    rules,
    unallocated: 90_900_000_000,
    pinned: false,
    signs,
  }
  const report = await pressEverything((said) => {
    mockGo.said = said
    return <AgentView data={data} onChanged={() => said('changed')} />
  })
  expect(report.dead).toEqual([])
  // Review, Pause or Resume, the pin switch and Statement; Fund waits for an amount and says so
  expect(report.pressed).toBe(pressed)
})
