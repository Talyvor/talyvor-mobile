import { type NoticeData, NoticeView, type SpendingData, SpendingView } from '../components/spending'
import { pressEverything } from '../testing/press-everything'

// B57.92 — pressEverything on Spending and on a payment's notice: every switch, notice, link and Back does something.

jest.setTimeout(30_000)

const mockGo = { said: (_: string) => undefined as void }
jest.mock('../session', () => ({
  useSession: () => ({ client: { setNoticeSettings: async (s: unknown) => (mockGo.said('saved'), s) }, peg: 0.1, signedIn: true }),
}))
jest.mock('expo-router', () => ({
  router: {
    push: (to: unknown) => mockGo.said(JSON.stringify(to)),
    navigate: (to: unknown) => mockGo.said(JSON.stringify(to)),
    canGoBack: () => true,
    back: () => mockGo.said('back'),
    replace: (to: unknown) => mockGo.said(JSON.stringify(to)),
  },
}))

const payment = { entry_id: 'ent_1', kind: 'card', merchant: 'Kite Accounting', agent_id: '', amount_minor: 45000, currency: 'USD', category: 'bills', created_at: '2026-10-01T09:00:00Z' }
const notice = { id: 'ntc_1', kind: 'payment', title: 'You paid $450.00 at Kite Accounting', body: 'Bills', data: { entry_id: 'ent_1' }, status: 'sent' as const, created_at: '2026-10-01T09:01:00Z' }

test('Spending: every switch, the save and each notice does something', async () => {
  const data: SpendingData = {
    week: [],
    month: [{ currency: 'USD', total: 45000, categories: [['bills', 45000]] }],
    payments: [payment],
    findings: [],
    budgets: [],
    subs: [],
    notices: [notice],
    settings: { timezone: 'Europe/London', quiet_from: '22:00', quiet_until: '07:00', off: [] },
    agents: [],
  }
  const report = await pressEverything((said) => {
    mockGo.said = said
    return <SpendingView data={data} />
  })
  expect(report.dead).toEqual([])
  // The six notice switches, Save notice settings and the notice.
  expect(report.pressed).toBe(8)
})

test('a payment’s notice: Back to Spending and See all your spending do something', async () => {
  const data: NoticeData = { notice, payment, agents: [] }
  const report = await pressEverything((said) => {
    mockGo.said = said
    return <NoticeView data={data} />
  })
  expect(report.dead).toEqual([])
  expect(report.pressed).toBe(2)
})
