// B57.64 — the BFF's answers in pocket-shots: the sample workspace of design/pocket/README.md, at 10:30 London on
// Thursday 22 October 2026. Figures are µLXC (1 LXC = 1,000,000) at $0.10 an LXC.
export const SAMPLE_NOW = '2026-10-22T09:30:00Z'
export const SAMPLE_TIME_ZONE = 'Europe/London'

const lxc = (n) => Math.round(n * 1_000_000)
/** A model's questions on a day, as Lens reads a statement by day (B57.13), and its platform fee the line under it. */
const spend = (posting_id, at, agent, model, day, requests, out) =>
  ({ posting_id, entry_id: `ent_${posting_id}`, at, account: `agent:${agent}`, kind: 'spend', amount_ulxc: -lxc(out), counterparty: 'spend', balance_after_ulxc: 0, model, day, requests })
const fee = (posting_id, at, agent, model, day, out) =>
  ({ posting_id, entry_id: `ent_${posting_id}`, at, account: `agent:${agent}`, kind: 'platform_fee', amount_ulxc: -lxc(out), counterparty: 'platform', balance_after_ulxc: 0, model, day, label: 'Platform fee 5.5%', memo: 'On those requests' })

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
    // B57.11: what pays it, the amount that made it ask and the month's budget left after (the reference's psheet-A).
    expires_at: '2026-10-23T08:17:00Z',
    paid_from: { kind: 'account', account_id: 'acc_research_usd', name: 'Research’s US dollar account', currency: 'USD', amount_minor: 34_000, balance_minor: 40_000 },
    asks_above_ulxc: lxc(2_500),
    budget_left_after_ulxc: lxc(4_200),
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
    expires_at: '2026-10-23T07:41:00Z',
    paid_from: { kind: 'marketplace_bill', account_id: '', name: 'Your monthly marketplace bill', currency: 'USD', amount_minor: 9_000, balance_minor: null },
    asks_above_ulxc: lxc(500),
    budget_left_after_ulxc: lxc(3_100),
  },
]

const sandbox = (capability, name) => ({ capability, name, class: 'GREEN', real_money: false, label: 'sandbox' })

const ANSWERS = {
  '/api/agents': { workspace_balance_ulxc: lxc(124_800), allocated_ulxc: lxc(33_900), unallocated_ulxc: lxc(90_900), spent_ulxc: lxc(28_000), agents },
  '/api/agents/approvals': { approvals },
  // B57.71: Pause every agent, instant; starting them again is signed over the resume-all challenge.
  '/api/agents/pause-all': { all_paused: true },
  '/api/agents/resume-all/challenge': { challenge: 'ch_resume_all' },
  '/api/agents/resume-all': { all_paused: false },
  // B57.67: deciding in the approval sheet, signed with the shots' phone key (`phoneKey`).
  ...Object.fromEntries(
    approvals.flatMap(({ id }) => [
      [`/api/agents/approvals/${id}/challenge`, { challenge: `ch_${id}` }],
      [`/api/agents/approvals/${id}/approve`, {}],
      [`/api/agents/approvals/${id}/deny`, {}],
    ]),
  ),
  // B57.135: Lens's public labels, which a signed-out screen (sign-up) reads for its Sandbox label.
  '/api/pricing': { labels: { payments_out: 'sandbox' } },
  // B57.126: Research's rules as the reference's agent page reads them, so its page loads in the shots.
  '/api/agents/agt_research/rules': { max_per_request_ulxc: lxc(10_000), daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: lxc(2_500), allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'Europe/London' },
  '/api/agents/agt_sales/rules': { max_per_request_ulxc: 0, daily_limit_ulxc: lxc(2_000), monthly_limit_ulxc: lxc(20_000), approval_above_ulxc: lxc(1_000), allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'Europe/London' },
  '/api/agents/agt_ops/rules': { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: lxc(10_000), approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: 'Europe/London' },
  // B59.34 — Research's card (pounds) declined Compute shop, £24.00, yesterday: not one of its payees.
  '/api/agents/agt_research/card': {
    card: { id: 'ic_research', agent_id: 'agt_research', last4: '0005', exp_month: 9, exp_year: 2029, currency: 'gbp', livemode: false, created_at: '2026-09-14T09:00:00Z' },
    authorizations: [
      { id: 'ca_compute', approved: false, reason: 'Not one of its payees.', amount_minor: 2_400, currency: 'gbp', merchant_name: 'Compute shop', created_at: '2026-10-21T15:12:00Z' },
    ],
  },
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
  // B59.29 — what the workspace sent: a complaint being looked at, a question answered, and a copy of its data ready.
  '/api/workspace/requests': {
    requests: [
      { id: 3, kind: 'data_export', state: 'done', reference: '', message: '', answer: '', filed_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-29T11:00:00Z' },
      { id: 2, kind: 'complaint', state: 'in_progress', reference: 'C-7KQ2-M4XD', message: 'A card payment to Kite Accounting was taken twice.', answer: '', filed_at: '2026-10-27T15:20:00Z', updated_at: '2026-10-28T08:00:00Z' },
      { id: 1, kind: 'support', state: 'done', reference: '', message: 'How do I add a payee?', answer: 'Open Payees and press Add. The payee is ready to pay at once.', filed_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T14:00:00Z' },
    ],
  },
  '/api/money/notices': { settings: { timezone: 'Europe/London', quiet_from: '22:00', quiet_until: '07:00', off: ['digest'] }, notices: [] },
  // B57.73 — the reference's statement read by model and day (London), each wallet's balance and the catalog's names.
  '/api/models': [
    { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
  ],
  '/api/agents/statement': {
    from: '2026-10-01',
    to: '2026-11-01',
    group: 'day',
    time_zone: 'Europe/London',
    accounts: [
      { account: 'agent:agt_research', opening_ulxc: lxc(6_524.4), in_ulxc: lxc(10_000), out_ulxc: lxc(24.4), closing_ulxc: lxc(16_500) },
      { account: 'agent:agt_sales', opening_ulxc: lxc(12_126.6), in_ulxc: 0, out_ulxc: lxc(126.6), closing_ulxc: lxc(12_000) },
      { account: 'agent:agt_ops', opening_ulxc: lxc(5_442.2), in_ulxc: 0, out_ulxc: lxc(42.2), closing_ulxc: lxc(5_400) },
    ],
    lines: [
      spend(8, '2026-10-22T09:24:00Z', 'agt_research', 'claude-sonnet-5', '2026-10-22', 312, 420),
      fee(7, '2026-10-22T09:24:00Z', 'agt_research', 'claude-sonnet-5', '2026-10-22', 23.1),
      spend(6, '2026-10-22T08:52:00Z', 'agt_sales', 'claude-haiku-4-5', '2026-10-22', 410, 120),
      fee(5, '2026-10-22T08:52:00Z', 'agt_sales', 'claude-haiku-4-5', '2026-10-22', 6.6),
      spend(4, '2026-10-21T10:12:00Z', 'agt_research', 'claude-haiku-4-5', '2026-10-21', 88, 20),
      fee(3, '2026-10-21T10:12:00Z', 'agt_research', 'claude-haiku-4-5', '2026-10-21', 1.1),
      { posting_id: 2, entry_id: 'ent_2', at: '2026-10-20T17:30:00Z', account: 'agent:agt_research', kind: 'fund', amount_ulxc: lxc(10_000), counterparty: 'workspace', balance_after_ulxc: lxc(16_524.4) },
      spend(1, '2026-10-20T16:05:00Z', 'agt_ops', 'claude-haiku-4-5', '2026-10-20', 140, 40),
      fee(0, '2026-10-20T16:05:00Z', 'agt_ops', 'claude-haiku-4-5', '2026-10-20', 2.2),
    ],
  },
}

/** The sample's answer for a path, or undefined when it has none. */
export function sampleBodyFor(path) {
  return ANSWERS[path]
}
