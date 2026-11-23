import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B62.11 — the phone's side of suite B62.10, the same words: with Lens B62.9's `stopped` on an approval, its Decided row
// and its own screen say in one sentence why the payment was stopped, and a used approval's screen shows the Proof that
// a payment's page draws, read by the approval's id, with Copy the proof.

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
const side = { agent_id: 'ag_research', payee, amount_minor: 15_000, currency: 'EUR' }
const base = { agent_id: 'ag_research', amount_ulxc: 1_500_000_000, model: '', payee, created_at: '2026-11-03T12:00:00Z', decided_at: '2026-11-03T12:05:00Z' }

/** One approval stopped for each of the four things Lens names, still approved; and one used, with its proof. */
const CHANGED = ['payee', 'amount', 'currency', 'agent'] as const
const APPROVALS = [
  ...CHANGED.map((changed) => ({ ...base, id: `apr_${changed}`, status: 'approved', stopped: { changed, at: '2026-11-03T12:10:00Z' } })),
  { ...base, id: 'apr_used', status: 'used', stopped: null },
]

/** Lens B62.9: the proof of the payment a used approval let through, read by the approval's id. */
const PROOF = {
  id: 'pp_1',
  rule: 'approval_above',
  rules_version: 4,
  approval_id: 'apr_used',
  shown: { ...side, agent_name: 'Research' },
  key_kind: 'device',
  key_id: 'dk_9',
  signed_at: '2026-11-03T12:05:00Z',
  sent: { ...side, rail: 'account', reference: 'ref_1', task: TASK },
  created_at: '2026-11-03T12:30:00Z',
  verified: true,
}

function mockBff() {
  const asked: string[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    asked.push(path)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    if (path === '/api/payment-proofs/apr_used') return json(PROOF)
    switch (`${init.method ?? 'GET'} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/lxc/topup-options':
        return json({ usd_per_lxc: 0.1, min_usd_cents: 1000 })
      case 'GET /api/agents':
        return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag_research', name: 'Research', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/agents/approvals':
        return json({ approvals: APPROVALS })
      case 'GET /api/agents/keys':
        return json({ keys: [{ kind: 'phone', id: 'dk_9', name: 'Nick’s iPhone', platform: 'ios', created_at: '2026-10-01T00:00:00Z' }] })
      case 'GET /api/money/accounts':
        return json({ accounts: [] })
      case 'GET /api/money/payment-requests':
        return json({ requests: [] })
      case 'GET /api/agents/keys/enrolments':
        return json({ enrolments: [] })
      case 'GET /api/wallets/capabilities':
        return json({ capabilities: [] })
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  }) as unknown as typeof fetch
  return asked
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockCopied.length = 0
})

test('a stopped approval says why on its Decided row and on its own screen, for each of the four things', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/approvals' })
  await screen.findByText('Decided')
  for (const changed of CHANGED) expect(screen.getByText(`Stopped: the ${changed} changed after you approved.`)).toBeTruthy()

  await fireEvent.press(screen.getByText('Stopped: the currency changed after you approved.'))
  await screen.findByText('Research’s request')
  expect(screen.getByText('Stopped: the currency changed after you approved.')).toBeTruthy()
  expect(screen.queryByText(/the (payee|amount|agent) changed/)).toBeNull()
  // Nothing was sent, so there is no proof to show.
  expect(screen.queryByTestId('payment-proof')).toBeNull()
})

test('a used approval opens its proof, read by the approval’s id, with Copy the proof', async () => {
  const asked = mockBff()
  await renderRouter('./src/app', { initialUrl: '/approvals/apr_used' })

  const proof = within(await screen.findByTestId('payment-proof'))
  expect(asked).toContain('/api/payment-proofs/apr_used')
  const facts = within(screen.getByTestId('proof-facts'))
  await waitFor(() => expect(facts.getByLabelText('Signed with: Face ID on Nick’s iPhone')).toBeTruthy())
  expect(facts.getByLabelText('You approved: €150.00 to Acme Hosting')).toBeTruthy()
  expect(facts.getByLabelText('What was sent: €150.00 to Acme Hosting')).toBeTruthy()
  expect(proof.getByText('The signature checks out: it is by this key, over exactly what you approved.')).toBeTruthy()
  expect(screen.getByText(`The agent says: “${TASK}”`)).toBeTruthy()
  expect(screen.queryByText(/^Stopped:/)).toBeNull()

  await fireEvent.press(proof.getByRole('button', { name: 'Copy the proof' }))
  expect(await proof.findByText('Proof copied')).toBeTruthy()
  expect(mockCopied[0].split('\n')[0]).toBe('Payment proof')
})
