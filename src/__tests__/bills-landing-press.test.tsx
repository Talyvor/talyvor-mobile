import type { AgentApproval, PaymentRequest } from '@talyvor/bff-client'

import { DecidedCard } from '../components/approval-card'
import { BillRows } from '../components/bill-rows'
import { pressEverything } from '../testing/press-everything'

// B57.78 — pressEverything on Bills due's rows and a decided approval's landing card: each goes somewhere.

jest.mock('../session', () => ({ useSession: () => ({ client: {}, peg: 0.1, signedIn: true }) }))
const mockGo = { said: (_: string) => undefined as void }
jest.mock('expo-router', () => ({ router: { push: (to: unknown) => mockGo.said(JSON.stringify(to)) } }))

const bill: PaymentRequest = {
  id: 'preq_1',
  status: 'pending_approval',
  summary: '',
  client: 'chat',
  totals: { USD: 18_000 },
  items: [{ position: 1, payee_id: 'py_1', payee_name: 'Northwind Data', currency: 'USD', amount_minor: 18_000, reference: 'Invoice 1042', decision: 'needs_approval', reason: '' }],
  created_at: '2026-11-09T08:00:00Z',
}
const declined: AgentApproval = {
  id: 'apr_2',
  agent_id: 'ag_sales',
  amount_ulxc: 900_000_000,
  model: '',
  payee: { kind: 'listing', id: 'l_1', name: 'Lead finder' },
  status: 'denied',
  created_at: '2026-10-14T00:00:00Z',
  decided_at: '2026-10-14T01:00:00Z',
}

test('Bills due’s rows and the landing card’s Approvals each do something', async () => {
  const report = await pressEverything((said) => {
    mockGo.said = said
    return (
      <>
        <BillRows requests={[bill, { ...bill, id: 'preq_2' }]} />
        <DecidedCard approval={declined} agentName="Sales" />
      </>
    )
  })
  expect(report).toEqual({ pressed: 3, dead: [] })
})
