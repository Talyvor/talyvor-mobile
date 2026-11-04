import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'

// B53.9 DONE: the Spending tab reads every number from a mocked Lens behind the BFF and saves the notice settings, and a
// payment's push opens that payment.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))

/** The notification the person tapped, as Lens's B53.7 push carries it. */
let mockTapResponse: unknown = null
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('../../__mocks__/expo-notifications'),
  useLastNotificationResponse: () => mockTapResponse,
}))

const payment = { entry_id: 'ent_2', kind: 'card', merchant: 'Pret A Manger', agent_id: '', amount_minor: 1250, currency: 'GBP', category: 'eating_out', created_at: '2026-11-03T12:30:00Z' }

/** Lens behind the BFF, as B53.3–B53.7 answer; `settings` is what the notice settings save sent. */
function mockLens() {
  const sent: { settings?: unknown } = {}
  const settings = { timezone: 'Europe/London', quiet_from: '', quiet_until: '', off: [] as string[] }
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    switch (`${init.method ?? 'GET'} ${path}`) {
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_1', name: 'Buyer', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/money/spending':
        return json({ from: '', to: '', payments: [payment], totals: [{ currency: 'GBP', total_minor: 4250, by_category: { eating_out: 1250, groceries: 3000 } }] })
      case 'GET /api/money/spending/unusual':
        return json({ findings: [{ rule: 'duplicate', entry_id: 'ent_3', merchant: 'Tesco', amount_minor: 3000, currency: 'GBP', at: '2026-11-03T09:00:00Z' }] })
      case 'GET /api/money/coach':
        return json({ lines: [{ fact: { kind: 'duplicate', merchant: 'Tesco' }, sentence: 'You paid Tesco 30.00 GBP twice within a minute.', source: 'template' }], review: [] })
      case 'GET /api/money/budgets':
        return json({ budgets: [{ id: 'bud_1', agent_id: '', category: 'eating_out', period: 'month', amount_minor: 5000, currency: 'GBP', spent_minor: 4100, left_minor: 900, percent: 82 }] })
      case 'GET /api/money/spending/subscriptions':
        return json({ subscriptions: [{ merchant: 'Netflix', category: 'subscriptions', amount_minor: 1099, currency: 'GBP', interval: 'monthly', next_at: '2026-11-20T00:00:00Z', yearly_minor: 13188 }] })
      case 'GET /api/money/notices':
        return json({
          settings,
          notices: [
            { id: 'ntc_1', kind: 'payment', title: 'You paid 12.50 GBP at Pret A Manger', body: 'Eating out · 9.00 GBP left of this month’s eating out budget', data: { entry_id: 'ent_2' }, status: 'sent', created_at: '2026-11-03T12:31:00Z' },
          ],
        })
      case 'PUT /api/money/notices/settings':
        sent.settings = JSON.parse(init.body as string)
        return json(sent.settings)
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
  }) as unknown as typeof fetch
  return sent
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockTapResponse = null
})

test('the Spending tab shows totals, budgets, the unusual payment with the Coach sentence and subscriptions, and saves notice settings', async () => {
  const sent = mockLens()
  await renderRouter('./src/app', { initialUrl: '/spending' })

  expect(await screen.findByText('Where your money went')).toBeTruthy()
  expect(await screen.findAllByText('Groceries')).toHaveLength(2) // this week and this month
  expect(screen.getByLabelText('Eating out · Your own wallet: budget used').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 82 })
  expect(screen.getByText('Possibly paid twice · Tesco')).toBeTruthy()
  expect(screen.getByText('You paid Tesco 30.00 GBP twice within a minute.')).toBeTruthy()
  expect(screen.getByText('131.88 GBP a year')).toBeTruthy()

  await fireEvent(screen.getByLabelText('Each payment'), 'valueChange', false)
  await fireEvent.changeText(screen.getByLabelText('Quiet from'), '22:00')
  await fireEvent.changeText(screen.getByLabelText('Quiet until'), '07:00')
  await fireEvent.press(screen.getByText('Save notice settings'))
  expect(await screen.findByText('Saved.')).toBeTruthy()
  expect(sent.settings).toEqual({ timezone: 'Europe/London', quiet_from: '22:00', quiet_until: '07:00', off: ['payment'] })
})

test("a payment's push opens that payment", async () => {
  mockLens()
  const data = { type: 'spend_notice', kind: 'payment', notice_id: 'ntc_1', workspace_id: 'ws_1' }
  mockTapResponse = { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: { request: { content: { data } } } }
  await renderRouter('./src/app', { initialUrl: '/' })

  expect(await screen.findByText('Pret A Manger', {}, { timeout: 5000 })).toBeTruthy()
  await waitFor(() => expect(screen.getByText('12.50 GBP')).toBeTruthy())
  expect(screen.getByText('Eating out')).toBeTruthy()
  expect(screen.getByText('Eating out · 9.00 GBP left of this month’s eating out budget')).toBeTruthy()
})
