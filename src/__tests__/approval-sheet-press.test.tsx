import type { AgentApproval } from '@talyvor/bff-client'

import { ApprovalResult, ApprovalSheet, PendingApprovals, type Decided } from '../components/approval-card'
import { pressEverything } from '../testing/press-everything'

// B57.67 — pressEverything on the approval sheet and its result screen: every control does something.

const mockClient = {
  rules: async () => ({ monthly_limit_ulxc: 20_000_000_000 }),
  capabilities: async () => ({ capabilities: [{ capability: 'payments_out', name: 'payments_out', class: 'GREEN', real_money: false, label: 'sandbox' }] }),
  approvalChallenge: () => new Promise(() => undefined),
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
jest.mock('../keys', () => ({ biometricName: 'Face ID', phoneKey: async () => ({ id: 'dk_1', here: true, owner: '' }), signWithThisPhone: async () => undefined }))
jest.mock('../live-activity', () => ({ syncLiveActivities: async () => undefined }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))

const acme: AgentApproval = {
  id: 'apr_acme',
  agent_id: 'ag_research',
  amount_ulxc: 3_400_000_000,
  model: '',
  payee: { kind: 'outside', id: 'py_acme', name: 'Acme Hosting' },
  status: 'pending',
  created_at: '2026-10-22T08:17:00Z',
  expires_at: '2026-10-23T08:17:00Z',
  paid_from: { kind: 'account', account_id: 'acc_usd', name: 'Research’s US dollar account', currency: 'USD', amount_minor: 34_000, balance_minor: 40_000 },
  asks_above_ulxc: 2_500_000_000,
  budget_left_after_ulxc: 4_200_000_000,
}
const research = { id: 'ag_research', name: 'Research' }

test('a waiting request: Review opens its sheet', async () => {
  const report = await pressEverything((said) => <PendingApprovals pending={[acme]} agents={[research]} allPaused={false} onDecided={() => said('decided')} />)
  expect(report.dead).toEqual([])
  expect(report.pressed).toBe(1)
})

test('the sheet: Approve with Face ID and Decline each do something', async () => {
  const report = await pressEverything((said) => (
    <ApprovalSheet approval={acme} agent={research} capability="payments_out" paused={false} onDecided={() => said('decided')} onApprovals={() => said('approvals')} />
  ))
  expect(report.dead).toEqual([])
  expect(report.pressed).toBe(2)
})

test('the result screen: Done and Next each do something', async () => {
  const d: Decided = { approval: acme, agent: research, capability: 'payments_out', approved: true, signed: true, paused: false, next: { id: 'apr_lead', title: 'Sales wants to use Lead finder' } }
  const report = await pressEverything((said) => <ApprovalResult d={d} onDone={() => said('done')} onNext={() => said('next')} />)
  expect(report.dead).toEqual([])
  expect(report.pressed).toBe(2)
})
