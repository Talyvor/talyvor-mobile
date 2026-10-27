import type { BffClient } from '@talyvor/bff-client'

import { mockActivities } from '../../__mocks__/expo-widgets'
import { syncLiveActivities } from '../live-activity'

// B41.36 DONE: a held payment starts a Live Activity that ends when the payment is approved or declined.

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('../../modules/talyvor-keys', () => ({ isAvailable: () => true }))

test('a held payment stays on the lock screen until it is approved or declined', async () => {
  // Lens behind the BFF: a request prepared for approval, and Research's held payment.
  const lens = { request: 'pending_approval', approval: 'pending' as string }
  const client = {
    pendingPaymentRequests: async () => ({
      requests:
        lens.request === 'pending_approval'
          ? [
              {
                id: 'preq_1',
                status: 'pending_approval',
                summary: 'Pay October suppliers',
                client: 'chat',
                totals: { GBP: 2500 },
                created_at: '2026-10-24T08:00:00Z',
                items: [{ position: 1, payee_id: 'py_1', payee_name: 'Acme Hosting', currency: 'GBP', amount_minor: 2500, reference: 'Oct', decision: 'needs_approval', reason: 'a new payee' }],
              },
            ]
          : [],
    }),
    paymentRequest: async (id: string) => ({ id, status: lens.request }),
    approvals: async () => ({
      approvals: [{ id: 'apr_1', agent_id: 'ag_1', amount_ulxc: 2_000_000, model: '', payee: { kind: 'merchant', id: 'm_1', name: 'Bolt Couriers' }, status: lens.approval, created_at: '2026-10-24T08:00:00Z' }],
    }),
    book: async () => ({ agents: [{ id: 'ag_1', name: 'Research' }] }),
  } as unknown as BffClient

  await syncLiveActivities(client)
  expect(mockActivities.map((a) => [a.url, a.props.state, a.props.title, a.props.amount])).toEqual([
    ['talyvor://approve/preq_1', 'waiting', 'Acme Hosting', '25.00 GBP'],
    ['talyvor://approvals/apr_1', 'waiting', 'Bolt Couriers', '2 LXC'],
  ])
  expect(mockActivities[0].props.hint).toBe('Tap to approve with Face ID')

  // Coming to the front again starts nothing new.
  await syncLiveActivities(client)
  expect(mockActivities).toHaveLength(2)
  expect(mockActivities.filter((a) => a.ended)).toHaveLength(0)

  // Approved on the web, declined on this phone: the next sync ends both, each showing how it was decided.
  lens.request = 'approved'
  lens.approval = 'denied'
  await syncLiveActivities(client)
  expect(mockActivities.map((a) => a.ended?.props?.state)).toEqual(['approved', 'declined'])
  expect(mockActivities).toHaveLength(2)
})
