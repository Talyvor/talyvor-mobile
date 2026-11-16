import type { AgentBook, CurrencyAccount } from '@talyvor/bff-client'
import { render, screen } from '@testing-library/react-native'
import type { ReactElement } from 'react'

import { shows } from '../account'
import { HomeView } from '../components/home'

// B61.80 — "Add money" in place of "Top up", and "Instant" under Home's round quick action (the Pay tab and the sheet
// keep "Instant transfer"). Nick approved both words on 15 Nov 2026.

const mockClient = { accounts: async () => [], capabilities: async () => ({ capabilities: [] }) }
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
jest.mock('../live-activity', () => ({ syncLiveActivities: async () => undefined }))
jest.mock('expo-router', () => ({
  router: { push: () => undefined },
  Link: ({ children }: { children: ReactElement }) => children,
}))

const book: AgentBook = { workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [] }
const accounts: CurrencyAccount[] = [
  { id: 'a1', currency: 'USD', purpose: 'company', status: 'open', name: '', balance_minor: 3_158_000, test_minor: 0, live_minor: 3_158_000 },
  { id: 'a3', currency: 'USDC', purpose: 'company', status: 'open', name: '', balance_minor: 16_700_000_000, test_minor: 0, live_minor: 16_700_000_000 },
]

async function home(money_kind: 'fiat' | 'hybrid', held: CurrencyAccount[]) {
  const account = { account_type: 'business', money_kind } as const
  await render(<HomeView data={{ book, approvals: [], prepared: [], accounts: held }} account={account} shows={shows(account)} name="Northwind Studio" peg={0.1} onDecided={() => undefined} />)
}

test('a Hybrid Home says Instant under the round quick action, not Instant transfer', async () => {
  await home('hybrid', accounts)
  // Read aloud it keeps the full name, which holds the word on the screen (WCAG 2.5.3).
  expect(screen.getByRole('link', { name: 'Instant transfer' })).toBeTruthy()
  expect(screen.getByText('Instant')).toBeTruthy()
  expect(screen.queryByText(/Instant transfer/)).toBeNull()
})

test('an empty Fiat Home says Add money to get started, never Top up', async () => {
  await home('fiat', [])
  expect(screen.getByText('Add money to get started.')).toBeTruthy()
  expect(screen.queryByText(/top.?up/i)).toBeNull()
})
