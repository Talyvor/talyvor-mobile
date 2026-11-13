import type { PaymentRequest } from '@talyvor/bff-client'

import ApproveScreen from '../app/approve/[id]'
import { pressEverything } from '../testing/press-everything'

// B57.74 — pressEverything on Approve payments: Back, Approve with Face ID and Decline each do something.

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
  book: async () => ({ agents: [] }),
  payees: async () => ({ payees: [] }),
  payments: async () => ({ payments: [] }),
  capabilities: async () => ({ capabilities: [] }),
  // Asked, never answered: what a press starts is what is checked.
  requestApproval: () => new Promise(() => undefined),
  cancelRequest: () => new Promise(() => undefined),
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
// The screen's pull-to-refresh is an element in a prop, which the press check cannot compare: the screen's frame is a View.
jest.mock('../components/ui', () => {
  const { View } = jest.requireActual('react-native')
  return { ...jest.requireActual('../components/ui'), Screen: ({ children }: { children: unknown }) => <View>{children}</View> }
})
jest.mock('../keys', () => ({ biometricName: 'Face ID' }))
jest.mock('../live-activity', () => ({ syncLiveActivities: async () => undefined }))
const mockGo = { said: (_: string) => undefined as void }
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'preq_1' }),
  router: { canGoBack: () => false, back: () => mockGo.said('back'), replace: (to: unknown) => mockGo.said(JSON.stringify(to)) },
}))

test('Approve payments: Back, Approve with Face ID and Decline each do something', async () => {
  const report = await pressEverything((said) => {
    mockGo.said = said
    return <ApproveScreen />
  })
  expect(report).toEqual({ pressed: 3, dead: [] })
})
