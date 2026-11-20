import type { PaymentRequest } from '@talyvor/bff-client'
import { act, render, screen, waitFor } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import ApproveScreen from '../app/approve/[id]'
import PauseAll from '../app/pause-all'

// B50.57 — Approve payments and Pause every agent open as the phone's own sheet (B61.77, `presentation: 'formSheet'`),
// which iOS draws above the app, so the app switcher's Cover in the main window sits under them: each draws it itself.

const request: PaymentRequest = {
  id: 'preq_1',
  status: 'pending_approval',
  summary: '',
  client: 'chat',
  totals: { USD: 18_000 },
  items: [{ position: 1, payee_id: 'py_1', payee_name: 'Northwind Data', currency: 'USD', amount_minor: 18_000, reference: 'Invoice 1042', decision: 'needs_approval', reason: 'no permission you signed covers it' }],
  created_at: '2026-11-09T08:00:00Z',
}
const mockClient = {
  paymentRequest: async () => request,
  book: async () => ({ agents: [{ id: 'ag_1', name: 'Research' }] }),
  payees: async () => ({ payees: [] }),
  payments: async () => ({ payments: [] }),
  capabilities: async () => ({ capabilities: [] }),
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
jest.mock('../keys', () => ({ biometricName: 'Face ID', phoneKey: async () => null }))
jest.mock('../live-activity', () => ({ syncLiveActivities: async () => undefined }))
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'preq_1' }),
  router: { canGoBack: () => false, canDismiss: () => false, back: jest.fn(), replace: jest.fn(), push: jest.fn() },
}))

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

test('Approve payments: the Cover over it while the app is away, and the payment is still there after', async () => {
  await render(<ApproveScreen />)
  await waitFor(() => expect(screen.getAllByText(/Northwind Data/).length).toBeGreaterThan(0))
  expect(screen.queryByTestId('app-cover')).toBeNull()
  await tellApp('inactive')
  expect(screen.getByTestId('app-cover')).toBeTruthy()
  await tellApp('active')
  expect(screen.queryByTestId('app-cover')).toBeNull()
  expect(screen.getAllByText(/Northwind Data/).length).toBeGreaterThan(0)
})

test('Pause every agent: the Cover over it while the app is away', async () => {
  await render(<PauseAll />)
  await waitFor(() => expect(screen.getAllByText(/Pause/).length).toBeGreaterThan(0))
  await tellApp('background')
  expect(screen.getByTestId('app-cover')).toBeTruthy()
})
