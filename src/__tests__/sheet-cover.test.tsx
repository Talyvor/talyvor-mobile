import type { AgentApproval } from '@talyvor/bff-client'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { AppState, Text, TextInput, type AppStateStatus } from 'react-native'

import { PendingApprovals } from '../components/approval-card'
import { BottomSheet } from '../components/pay-sheet'

// B50.57 — a sheet is drawn above the main window on iOS, so the app switcher's Cover in the main window sits under it.
// Every sheet draws the Cover inside itself while the app is not in front, and stays up, so what was typed is kept.

const mockClient = {
  rules: async () => ({ monthly_limit_ulxc: 20_000_000_000 }),
  capabilities: async () => ({ capabilities: [{ capability: 'payments_out', name: 'payments_out', class: 'GREEN', real_money: false, label: 'sandbox' }] }),
  approvalChallenge: () => new Promise(() => undefined),
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
jest.mock('../keys', () => ({ biometricName: 'Face ID', phoneKey: async () => ({ id: 'dk_1', here: true, owner: '' }), signWithThisPhone: async () => undefined }))
jest.mock('../live-activity', () => ({ syncLiveActivities: async () => undefined }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))

let appState: ((s: AppStateStatus) => void)[] = []
const tellApp = (s: AppStateStatus) => act(async () => appState.forEach((f) => f(s)))
beforeEach(() => {
  appState = []
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, f) => {
    appState.push(f as (s: AppStateStatus) => void)
    return { remove: () => (appState = appState.filter((g) => g !== f)) } as ReturnType<typeof AppState.addEventListener>
  })
})
afterEach(() => jest.restoreAllMocks())

/** The Cover, when one is drawn inside the sheet's own Modal (the window iOS puts above the app), else null. */
const coverInSheet = () => {
  const cover = screen.queryByTestId('app-cover')
  for (let el: ReturnType<typeof screen.queryByTestId> = cover; el; el = el.parent) if (el.type === 'Modal') return cover
  return null
}

test('a money sheet: the Cover inside it while the app is away, and what was typed is still there after', async () => {
  await render(
    <BottomSheet visible onClose={() => undefined} testID="your-accounts">
      <Text>£1,240.00</Text>
      <TextInput accessibilityLabel="Amount" />
    </BottomSheet>,
  )
  await fireEvent.changeText(screen.getByLabelText('Amount'), '25')
  expect(coverInSheet()).toBeNull()
  await tellApp('inactive')
  expect(coverInSheet()).toBeTruthy()
  await tellApp('active')
  expect(coverInSheet()).toBeNull()
  expect(screen.getByDisplayValue('25')).toBeTruthy()
})

const acme: AgentApproval = {
  id: 'apr_acme',
  agent_id: 'ag_research',
  amount_ulxc: 3_400_000_000,
  model: '',
  payee: { kind: 'outside', id: 'py_acme', name: 'Acme Hosting' },
  status: 'pending',
  created_at: '2026-10-22T08:17:00Z',
  expires_at: '2099-10-23T08:17:00Z',
  paid_from: { kind: 'account', account_id: 'acc_usd', name: 'Research’s US dollar account', currency: 'USD', amount_minor: 34_000, balance_minor: 40_000 },
  asks_above_ulxc: 2_500_000_000,
  budget_left_after_ulxc: 4_200_000_000,
}

test('the approval sheet: the Cover inside it while the app is away', async () => {
  await render(<PendingApprovals pending={[acme]} agents={[{ id: 'ag_research', name: 'Research' }]} allPaused={false} focus="apr_acme" onDecided={() => undefined} />)
  await waitFor(() => expect(screen.getAllByText(/Acme Hosting/).length).toBeGreaterThan(0))
  await tellApp('background')
  expect(coverInSheet()).toBeTruthy()
})
