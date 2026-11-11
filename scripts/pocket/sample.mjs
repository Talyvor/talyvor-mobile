// B57.64 — the BFF's answers in pocket-shots: the sample workspace of design/pocket/README.md, at 10:30 London on
// Thursday 22 October 2026. Figures are µLXC (1 LXC = 1,000,000) at $0.10 an LXC.
export const SAMPLE_NOW = '2026-10-22T09:30:00Z'
export const SAMPLE_TIME_ZONE = 'Europe/London'

const lxc = (n) => n * 1_000_000

const agents = [
  { id: 'agt_research', name: 'Research', colour: 'cobalt', face: 'circle', balance_ulxc: lxc(16_500), spent_ulxc: lxc(12_400), created_at: '2026-09-14T09:00:00Z' },
  { id: 'agt_sales', name: 'Sales', colour: 'orchid', face: 'squircle', balance_ulxc: lxc(12_000), spent_ulxc: lxc(11_000), created_at: '2026-10-05T09:00:00Z' },
  { id: 'agt_ops', name: 'Ops', colour: 'lemon', face: 'flower', balance_ulxc: lxc(5_400), spent_ulxc: lxc(4_600), created_at: '2026-10-09T09:00:00Z', paused_at: '2026-10-21T17:00:00Z' },
]

const approvals = [
  {
    id: 'apr_acme',
    agent_id: 'agt_research',
    amount_ulxc: lxc(3_400),
    model: '',
    reason: 'October hosting invoice',
    payee: { kind: 'outside', id: 'py_acme', name: 'Acme Hosting' },
    status: 'pending',
    created_at: '2026-10-22T08:17:00Z',
  },
  {
    id: 'apr_lead',
    agent_id: 'agt_sales',
    amount_ulxc: lxc(900),
    model: '',
    payee: { kind: 'listing', id: 'lst_lead_finder', name: 'Lead finder' },
    memo: 'One use of Lead finder (version 3), $90.00 (900 LXC) on your monthly marketplace bill',
    status: 'pending',
    created_at: '2026-10-22T07:41:00Z',
  },
]

const sandbox = (capability, name) => ({ capability, name, class: 'GREEN', real_money: false, label: 'sandbox' })

const ANSWERS = {
  '/api/agents': { workspace_balance_ulxc: lxc(124_800), allocated_ulxc: lxc(33_900), unallocated_ulxc: lxc(90_900), spent_ulxc: lxc(28_000), agents },
  '/api/agents/approvals': { approvals },
  '/api/money/payment-requests': { requests: [] },
  '/api/lxc/topup-options': { usd_per_lxc: 0.1, min_usd_cents: 1000 },
  '/api/wallets/capabilities': {
    capabilities: [
      sandbox('spend_on_talyvor', 'Spending on Talyvor'),
      sandbox('move_between_own_agents', 'Moving money between your own agents'),
      sandbox('payments_out', 'Paying people and companies outside Talyvor'),
      sandbox('buy_marketplace_listings', 'Buying on the marketplace'),
      sandbox('pay_another_owner', "Paying another owner's agent"),
    ],
  },
  '/api/payees': { payees: [] },
  // B57.72: the reference's saved payees, the last payment to Kite Accounting, and the company's dollar account.
  '/api/money/payees': {
    payees: [
      { id: 'py_kite', name: 'Kite Accounting', country: 'GB', needs_confirmation: false, created_at: '2026-09-20T09:00:00Z' },
      { id: 'py_north', name: 'Northwind Data', country: 'GB', needs_confirmation: false, created_at: '2026-10-20T09:00:00Z' },
    ],
  },
  '/api/money/payments': {
    payments: [{ id: 'pm_kite', payee_id: 'py_kite', payee_name: 'Kite Accounting', amount_minor: 45_000, currency: 'USD', reference: 'October bookkeeping', status: 'completed', created_at: '2026-10-01T10:00:00Z' }],
  },
  '/api/money/accounts': { accounts: [{ id: 'acc_usd', currency: 'USD', purpose: 'company', status: 'open', name: '', balance_minor: 320_000 }] },
}

/** The sample's answer for a path, or undefined when it has none. */
export function sampleBodyFor(path) {
  return ANSWERS[path]
}
