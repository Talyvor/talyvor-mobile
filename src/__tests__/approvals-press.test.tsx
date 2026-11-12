import type { AgentApproval, PaymentRequest } from '@talyvor/bff-client'

import { DecidedApprovals } from '../components/approval-card'
import { PreparedPaymentCard } from '../components/prepared-payment-card'
import { pressEverything } from '../testing/press-everything'

// B57.68 — pressEverything on Approvals' own rows: a prepared payment's Review and each decided row go somewhere.

const mockClient = {
  capabilities: async () => ({ capabilities: [{ capability: 'payments_out', name: 'payments_out', class: 'GREEN', real_money: false, label: 'sandbox' }] }),
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
const mockGo = { said: (_: string) => undefined as void }
jest.mock('expo-router', () => ({ router: { push: (to: unknown) => mockGo.said(JSON.stringify(to)) } }))

const preq: PaymentRequest = {
  id: 'preq_1',
  status: 'pending_approval',
  summary: '',
  client: 'chat',
  totals: { USD: 18_000 },
  items: [{ position: 1, payee_id: 'py_1', payee_name: 'Northwind Data', currency: 'USD', amount_minor: 18_000, reference: 'Invoice 1042', decision: 'needs_approval', reason: '' }],
  created_at: '2026-11-09T08:00:00Z',
}
const decided: AgentApproval[] = [
  { id: 'apr_1', agent_id: 'ag_research', amount_ulxc: 3_400_000_000, model: '', payee: { kind: 'outside', id: 'py_1', name: 'Acme Hosting' }, status: 'approved', created_at: '2026-11-01T00:00:00Z', decided_at: '2026-11-01T01:00:00Z' },
  { id: 'apr_2', agent_id: 'ag_sales', amount_ulxc: 900_000_000, model: '', payee: { kind: 'listing', id: 'l_1', name: 'Lead finder' }, status: 'denied', created_at: '2026-10-14T00:00:00Z', decided_at: '2026-10-14T01:00:00Z' },
]
const agents = [
  { id: 'ag_research', name: 'Research' },
  { id: 'ag_sales', name: 'Sales' },
]

test('Approvals: a prepared payment’s Review and each decided row each do something', async () => {
  const report = await pressEverything((said) => {
    mockGo.said = said
    return (
      <>
        <PreparedPaymentCard request={preq} />
        <DecidedApprovals decided={decided} agents={agents} />
      </>
    )
  })
  expect(report).toEqual({ pressed: 3, dead: [] })
})
