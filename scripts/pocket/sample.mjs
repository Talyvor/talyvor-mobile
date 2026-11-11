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
  // B57.135: Lens's public labels, which a signed-out screen (sign-up) reads for its Sandbox label.
  '/api/pricing': { labels: { payments_out: 'sandbox' } },
  // B57.126: Research's rules as the reference's agent page reads them, so its page loads in the shots.
  '/api/agents/agt_research/rules': { max_per_request_ulxc: lxc(10_000), daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: lxc(2_500), allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'Europe/London' },
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
  // B59.35 — Settings and Activity.
  '/auth/me': { workspace_id: 'ws_northwind' },
  '/api/workspace/name': { id: 'ws_northwind', name: 'Northwind Studio' },
  // B59.11 — every workspace Lens had before B59.6 is Business and Hybrid.
  '/api/workspace/account': { workspace_id: 'ws_northwind', account_type: 'business', money_kind: 'hybrid' },
  '/api/money/notices': { settings: { timezone: 'Europe/London', quiet_from: '22:00', quiet_until: '07:00', off: ['digest'] }, notices: [] },
  '/api/agents/statement': {
    from: '2026-10-01',
    to: '2026-11-01',
    accounts: [],
    lines: [
      { posting_id: 3, entry_id: 'ent_3', at: '2026-10-21T15:12:00Z', account: 'agent:agt_sales', kind: 'pay', amount_ulxc: -lxc(900), counterparty: 'outside', balance_after_ulxc: lxc(12_000), label: 'Lead finder' },
      { posting_id: 2, entry_id: 'ent_2', at: '2026-10-14T10:05:00Z', account: 'agent:agt_research', kind: 'card', amount_ulxc: -lxc(1_250), counterparty: 'outside', balance_after_ulxc: lxc(16_500), label: 'Northwind Data' },
      { posting_id: 1, entry_id: 'ent_1', at: '2026-10-02T09:00:00Z', account: 'agent:agt_research', kind: 'fund', amount_ulxc: lxc(5_000), counterparty: 'workspace', balance_after_ulxc: lxc(17_750), label: 'Funded by you' },
    ],
  },
}

/** The sample's answer for a path, or undefined when it has none. */
export function sampleBodyFor(path) {
  return ANSWERS[path]
}
