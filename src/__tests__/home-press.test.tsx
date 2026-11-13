import type { AgentBook, CurrencyAccount } from '@talyvor/bff-client'
import type { ReactElement } from 'react'

import { shows } from '../account'
import { HomeError, HomeHeader, HomeView } from '../components/home'
import { pressEverything } from '../testing/press-everything'

// B57.66 — pressEverything on Home: every link, button and row does something.

const mockClient = {
  capabilities: async () => ({ capabilities: [{ capability: 'payments_out', name: 'payments_out', class: 'GREEN', real_money: false, label: 'sandbox' }] }),
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
jest.mock('../live-activity', () => ({ syncLiveActivities: async () => undefined }))
// A link here is where it goes: pressing it says so.
const mockGo = { said: (_: string) => undefined as void }
jest.mock('expo-router', () => ({
  router: { push: (to: string) => mockGo.said(to) },
  Link: ({ href, children }: { href: unknown; children: ReactElement<{ onPress?: () => void }> }) => jest.requireActual<typeof import('react')>('react').cloneElement(children, { onPress: () => mockGo.said(JSON.stringify(href)) }),
}))

const book: AgentBook = {
  workspace_balance_ulxc: 0,
  allocated_ulxc: 0,
  unallocated_ulxc: 0,
  spent_ulxc: 0,
  agents: [
    { id: 'ag_research', name: 'Research', description: 'Research', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' },
    { id: 'ag_sales', name: 'Sales', balance_ulxc: 3_000_000, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z', paused_at: '2026-11-01T00:00:00Z' },
  ],
}
const accounts: CurrencyAccount[] = [
  { id: 'a1', currency: 'USD', purpose: 'company', status: 'open', name: '', balance_minor: 3_158_000 },
  { id: 'a2', agent_id: 'ag_research', currency: 'USD', purpose: 'agent', status: 'open', name: '', balance_minor: 620_000 },
  { id: 'a3', currency: 'USDC', purpose: 'company', status: 'open', name: '', balance_minor: 16_700_000_000 },
]
const business = { account_type: 'business', money_kind: 'hybrid' } as const
const preq = { id: 'preq_1', status: 'pending_approval', summary: '', client: 'chat', totals: { USD: 18_000 }, items: [], created_at: '2026-11-09T08:00:00Z' } as never

test('Home: the waiting row, a prepared payment, Pay, Activity, the cards, each agent and Pause every agent each go somewhere', async () => {
  const report = await pressEverything((said) => {
    mockGo.said = said
    return <HomeView data={{ book, approvals: [], prepared: [preq], accounts }} account={business} shows={shows(business)} name="Northwind Studio" peg={0.1} onDecided={() => said('decided')} />
  })
  expect(report.dead).toEqual([])
  // waiting row, prepared payment, Wallets, Pay, Activity, See all cards, the owner's card, two agents' cards, two rows, Pause every agent
  expect(report.pressed).toBe(12)
})

test("Home's top and its failed read: Settings and Try again each do something", async () => {
  const top = await pressEverything((said) => {
    mockGo.said = said
    return <HomeHeader name="Maya Lind" account={{ account_type: 'personal', money_kind: 'fiat' }} />
  })
  expect(top).toEqual({ pressed: 1, dead: [] })
  expect((await pressEverything((said) => <HomeError onRetry={() => said('retry')} />)).dead).toEqual([])
})
