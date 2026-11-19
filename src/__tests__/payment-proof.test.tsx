import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B62.4 — the phone's side of suite B62.3: a payment opened from Spending shows the agent's task ("The agent says: …")
// and its proof from Lens B62.1 (what you approved, when, the key, the rule, what was sent, whether the signature checks
// out), with Copy the proof; the approval card and its sheet show the task the same way.

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))
const mockCopied: string[] = []
jest.mock('expo-clipboard', () => ({ setStringAsync: async (s: string) => void mockCopied.push(s) }))

const TASK = 'Renew the hosting for the research cluster'
const payee = { kind: 'outside', id: 'py_acme', name: 'Acme Hosting' }
const pay = (entry: string) => ({ entry_id: entry, kind: 'pay', merchant: 'Acme Hosting', agent_id: 'ag_research', amount_minor: 15_000, currency: 'EUR', category: 'software', created_at: '2026-11-03T12:30:00Z' })
const side = { agent_id: 'ag_research', payee, amount_minor: 15_000, currency: 'EUR' }

/** Lens B62.1's record of each payment: one the owner approved with this phone's key, one whose signature fails, and one
 * the rules passed; ent_none was never judged (404). */
const PROOFS: Record<string, unknown> = {
  ent_approved: {
    id: 'pp_1',
    rule: 'approval_above',
    rules_version: 4,
    approval_id: 'apr_1',
    shown: { ...side, agent_name: 'Research' },
    key_kind: 'device',
    key_id: 'dk_9',
    signed_at: '2026-11-03T12:29:00Z',
    sent: { ...side, rail: 'account', reference: 'ref_1', task: TASK },
    created_at: '2026-11-03T12:30:00Z',
    verified: true,
  },
  ent_forged: {
    id: 'pp_2',
    rule: 'approval_above',
    rules_version: 4,
    shown: { ...side, agent_name: 'Research' },
    key_kind: 'passkey',
    key_id: 'cred_1',
    signed_at: '2026-11-03T12:29:00Z',
    sent: { ...side, rail: 'account', reference: 'ref_2' },
    created_at: '2026-11-03T12:30:00Z',
    verified: false,
  },
  ent_passed: {
    id: 'pp_3',
    rule: 'within_rules',
    rules_version: 2,
    shown: { ...side, agent_name: 'Research' },
    sent: { ...side, rail: 'account', reference: 'ref_3' },
    created_at: '2026-11-03T12:30:00Z',
    verified: false,
  },
}

const approval = {
  id: 'apr_acme',
  agent_id: 'ag_research',
  amount_ulxc: 1_500_000_000,
  model: '',
  reason: 'November hosting invoice',
  payee,
  status: 'pending',
  created_at: '2026-11-03T12:00:00Z',
  task: TASK,
}

function mockBff() {
  const asked: string[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    asked.push(path)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    const proof = /^\/api\/payment-proofs\/(.+)$/.exec(path)
    if (proof) return PROOFS[proof[1]] ? json(PROOFS[proof[1]]) : new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    switch (`${init.method ?? 'GET'} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/lxc/topup-options':
        return json({ usd_per_lxc: 0.1, min_usd_cents: 1000 })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_research', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/money/spending':
        return json({ from: '', to: '', payments: ['ent_approved', 'ent_forged', 'ent_passed', 'ent_none'].map(pay), totals: [] })
      case 'GET /api/money/spending/unusual':
        return json({ findings: [] })
      case 'GET /api/money/coach':
        return json({ lines: [], review: [] })
      case 'GET /api/money/budgets':
        return json({ budgets: [] })
      case 'GET /api/money/spending/subscriptions':
        return json({ subscriptions: [] })
      case 'GET /api/money/notices':
        return json({ settings: { timezone: 'UTC', quiet_from: '', quiet_until: '', off: [] }, notices: [] })
      case 'GET /api/agents/keys':
        return json({ keys: [{ kind: 'phone', id: 'dk_9', name: 'Nick’s iPhone', platform: 'ios', created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/agents/approvals':
        return json({ approvals: [approval] })
      case 'GET /api/money/accounts':
        return json({ accounts: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/agents/keys/enrolments':
        return json({ enrolments: [] })
      case 'GET /api/wallets/capabilities':
        return json({ capabilities: [] })
      case 'GET /api/agents/ag_research/rules':
        return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'UTC' })
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
  }) as unknown as typeof fetch
  return asked
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockCopied.length = 0
})

/** Opens the nth payment on Spending, as the owner would. */
async function openPayment(n: number) {
  await renderRouter('./src/app', { initialUrl: '/spending' })
  await screen.findByText('This month’s payments')
  await fireEvent.press(screen.getAllByText('Acme Hosting')[n])
  await screen.findByText('Payment')
}

const facts = () => within(screen.getByTestId('proof-facts'))

test('an approved payment’s proof: what you approved, when, the phone that signed, the rule, what was sent, and that it checks out', async () => {
  mockBff()
  await openPayment(0)

  const proof = within(await screen.findByTestId('payment-proof'))
  expect(proof.getByText('Proof')).toBeTruthy()
  await waitFor(() => expect(facts().getByLabelText('Signed with: Face ID on Nick’s iPhone')).toBeTruthy())
  expect(facts().getByLabelText('You approved: €150.00 to Acme Hosting')).toBeTruthy()
  expect(facts().getByLabelText(/^When: 3 Nov, \d\d:29$/)).toBeTruthy()
  expect(facts().getByLabelText('The rule: It was above the amount the agent’s rules ask you about (rules version 4)')).toBeTruthy()
  expect(facts().getByLabelText('What was sent: €150.00 to Acme Hosting')).toBeTruthy()
  expect(proof.getByText('The signature checks out: it is by this key, over exactly what you approved.')).toBeTruthy()
  expect(proof.queryByText(/pp_1|apr_1|dk_9|ref_1/)).toBeNull()
})

test('a payment the rules passed names the rule that passed it, and no key', async () => {
  mockBff()
  await openPayment(2)

  const proof = within(await screen.findByTestId('payment-proof'))
  expect(facts().getByLabelText('The rule: Inside the agent’s rules, so it needed no approval (rules version 2)')).toBeTruthy()
  expect(facts().getByLabelText('What was sent: €150.00 to Acme Hosting')).toBeTruthy()
  expect(facts().queryByText('Signed with')).toBeNull()
  expect(facts().queryByText('You approved')).toBeNull()
  expect(proof.queryByText(/signature/)).toBeNull()
})

test('a signature that does not check out says so, and a passkey with no name is Your passkey', async () => {
  mockBff()
  await openPayment(1)

  const proof = within(await screen.findByTestId('payment-proof'))
  await waitFor(() => expect(facts().getByLabelText('Signed with: Your passkey')).toBeTruthy())
  expect(proof.getByText('The signature does not check out against what you approved.')).toBeTruthy()
})

test('the agent’s task sits under who it was paid to, after The agent says', async () => {
  // B57.191 — as the web's B57.190 and the approval sheet draw what a payment is for: in the receipt, under its "to" line,
  // before its facts and its proof.
  mockBff()
  await openPayment(0)
  const receipt = within(await screen.findByTestId('payment-receipt'))
  const says = await receipt.findByText(`The agent says: “${TASK}”`)
  expect(receipt.getByTestId('payment-to')).toHaveTextContent('to Acme Hosting')
  expect(receipt.getByLabelText('What: software')).toBeTruthy()
  expect(within(await screen.findByTestId('payment-proof')).queryByText(`The agent says: “${TASK}”`)).toBeNull()
  expect(says).toBeTruthy()
})

test('the proof is its own section in the receipt, and its verdict carries a tick or a cross', async () => {
  // B57.191 — drawn as the P10 receipt draws a section of its own: a cloud plane with Proof inside, the facts on the page.
  mockBff()
  await openPayment(0)
  const receipt = within(await screen.findByTestId('payment-receipt'))
  const ok = within(await receipt.findByTestId('proof-verdict'))
  expect(ok.getByText('The signature checks out: it is by this key, over exactly what you approved.')).toBeTruthy()
  expect(ok.getByTestId('icon-check', { includeHiddenElements: true })).toBeTruthy()
  expect(ok.queryByTestId('icon-x', { includeHiddenElements: true })).toBeNull()
  expect(receipt.getByRole('header', { name: 'Proof' })).toBeTruthy()

  await fireEvent.press(screen.getByText('Spending'))
  await screen.findByText('This month’s payments')
  await fireEvent.press(screen.getAllByText('Acme Hosting')[1])
  const bad = within(await screen.findByTestId('proof-verdict'))
  expect(bad.getByText('The signature does not check out against what you approved.')).toBeTruthy()
  expect(bad.getByTestId('icon-x', { includeHiddenElements: true })).toBeTruthy()
})

test('a payment the rules never judged shows no proof', async () => {
  const asked = mockBff()
  await openPayment(3)
  await waitFor(() => expect(asked).toContain('/api/payment-proofs/ent_none'))
  expect(screen.queryByTestId('payment-proof')).toBeNull()
  expect(screen.queryByText('Proof')).toBeNull()
})

test('Copy the proof copies it as text, for a dispute', async () => {
  mockBff()
  await openPayment(0)
  const proof = within(await screen.findByTestId('payment-proof'))
  await waitFor(() => expect(facts().getByLabelText('Signed with: Face ID on Nick’s iPhone')).toBeTruthy())
  await fireEvent.press(proof.getByRole('button', { name: 'Copy the proof' }))

  expect(await proof.findByText('Proof copied')).toBeTruthy()
  expect(mockCopied).toHaveLength(1)
  const lines = mockCopied[0].split('\n')
  expect(lines.slice(0, 3)).toEqual(['Payment proof', `The agent says: “${TASK}”`, 'You approved: €150.00 to Acme Hosting'])
  expect(lines).toContain('Signed with: Face ID on Nick’s iPhone')
  expect(lines).toContain('The rule: It was above the amount the agent’s rules ask you about (rules version 4)')
  expect(lines).toContain('What was sent: €150.00 to Acme Hosting')
  expect(lines.at(-1)).toBe('The signature checks out: it is by this key, over exactly what you approved.')
})

test('the approval card and its sheet show the agent’s task the same way', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/approvals' })

  const review = await screen.findByRole('button', { name: 'Review: Research wants to pay Acme Hosting' })
  expect(screen.getByText(`The agent says: “${TASK}”`)).toBeTruthy()
  await fireEvent.press(review)
  const sheet = within(await screen.findByTestId('approval-sheet'))
  expect(sheet.getByText(`The agent says: “${TASK}”`)).toBeTruthy()
})
