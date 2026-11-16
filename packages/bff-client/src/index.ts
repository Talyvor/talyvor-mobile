// @talyvor/bff-client — the phone app's reads and writes through the BFF's /api/agents and /api/money routes, the same
// routes the web's agentBankApi.ts calls. Every amount is an integer: µLXC, or a currency's minor units; never a float.
//
// The BFF answers a refusal with {"error": "<Lens's sentence>"}; BffError carries that sentence, because it is the
// answer to "why not?" and the screen shows it.

/** Lens economy.Agent. */
export interface Agent {
  id: string
  name: string
  balance_ulxc: number
  spent_ulxc: number
  created_at: string
  /** set while the agent is paused: every movement is refused until it is resumed */
  paused_at?: string
  paused_reason?: string
  description?: string
  archived_at?: string
  /** B57.10: the colour and face Lens picked from the id (or the owner chose); the phone draws them. */
  colour?: string
  face?: string
  /** B48.1 — fiat, crypto or both: the wallets it owns, and the currency its fiat wallet is in (B61.88: its rules' currency). */
  wallet_kind?: 'fiat' | 'crypto' | 'both'
  fiat_currency?: string
}

/** Lens economy.AgentBook: workspace = allocated + unallocated. */
export interface AgentBook {
  workspace_balance_ulxc: number
  allocated_ulxc: number
  unallocated_ulxc: number
  spent_ulxc: number
  agents: Agent[] | null
  all_paused_at?: string
}

/** Lens economy.AgentRules. A zero limit and an empty list are "no rule". */
export interface AgentRules {
  max_per_request_ulxc: number
  hourly_limit_ulxc?: number
  daily_limit_ulxc: number
  weekly_limit_ulxc?: number
  monthly_limit_ulxc: number
  requests_per_minute?: number
  approval_above_ulxc: number
  allowed_models: string[] | null
  allowed_providers: string[] | null
  blocked_payees?: string[] | null
  allowed_payees?: string[] | null
  active_from: string
  active_until: string
  timezone: string
  /** B59.20 — "Can use Instant transfer" (Lens B59.15), off by default. A save without it keeps what Lens holds. */
  may_instant_transfer?: boolean
  /** B61.88 — the currency the rules are held in, GBP, EUR, USD or USDC (Lens B61.12), and each amount limit in its minor
   * units. The µLXC limits above are what these are worth for the parked gateway; a save names these and not those. */
  currency?: string
  max_per_payment_minor?: number
  hourly_limit_minor?: number
  daily_limit_minor?: number
  weekly_limit_minor?: number
  monthly_limit_minor?: number
  approval_above_minor?: number
}

/** B61.88 — the rules as a save names them: the currency and its minor-unit limits, and no µLXC limit. */
export type AgentRulesSave = Omit<AgentRules, 'max_per_request_ulxc' | 'hourly_limit_ulxc' | 'daily_limit_ulxc' | 'weekly_limit_ulxc' | 'monthly_limit_ulxc' | 'approval_above_ulxc'>

/** The day's euro reference rates (the BFF's /api/fx, B28.22). */
export interface FXRates {
  rate_date: string
  usd_per_eur: number
  gbp_per_eur: number
}

/** Lens economy.AgentCard (B19.12): an agent's virtual card. The number stays with the issuer. */
export interface AgentCard {
  id: string
  agent_id: string
  last4: string
  exp_month: number
  exp_year: number
  /** lower-case ISO code */
  currency: string
  livemode: boolean
  created_at: string
  /** B28.360 — Lens declines every purchase on a frozen card until it is unfrozen */
  frozen?: boolean
  frozen_at?: string
}

/** B57.70 — Lens economy.AgentSummary (B57.12, relayed by the BFF's B57.20): one agent's page, every figure read in one
 * transaction at `as_of`. */
export interface AgentSummary {
  as_of: string
  agent: Agent
  /** set while every agent of the workspace is paused, this one with them */
  all_paused_at?: string
  month: { start: string; end: string; spent_ulxc: number; forecast_ulxc: number; monthly_limit_ulxc: number }
  /** its requests waiting for a person, newest first */
  approvals: AgentApproval[] | null
  card: { status: 'none' | 'active' | 'frozen'; currency?: string; last4?: string }
  currency_accounts: CurrencyAccount[] | null
}

/** B59.44 — Lens economy.RulesJudgement (B55.13): whether a change loosens the rules, each rule it changes in words, and
 * the challenge a looser one is signed over. */
export interface RulesJudgement {
  looser: boolean
  changes: string[] | null
  challenge?: string
  allow_credentials: string[] | null
}

/** B59.44 — the person a card is issued to, as the web's cardholder form asks for them (Lens B19.12). */
export interface Cardholder {
  first_name: string
  last_name: string
  email: string
  /** E.164, e.g. +447700900123; Lens falls back to an unallocated number in test mode when empty (B27.21) */
  phone_number: string
  line1: string
  line2: string
  city: string
  postal_code: string
  /** ISO 3166-1 alpha-2; Lens takes GB when empty */
  country: string
}

/** Lens economy.CardAuthorizationRecord: one purchase on the card, approved or declined by the agent's rules. */
export interface CardAuthorization {
  id: string
  approved: boolean
  /** Lens's sentence: why it was declined, or what approved it */
  reason: string
  /** in the card's currency, minor units */
  amount_minor: number
  currency: string
  merchant_name: string
  created_at: string
}

/** Lens economy.AgentApproval. `model` is empty for a payment. */
export interface AgentApproval {
  id: string
  agent_id: string
  amount_ulxc: number
  model: string
  reason?: string
  payee?: { kind: string; id: string; name: string }
  memo?: string
  status: 'pending' | 'approved' | 'denied' | 'used' | 'expired'
  created_at: string
  /** when it was approved or denied; on an expired one, set only if it was approved and then not used */
  decided_at?: string
  /** when it stops being usable: a pending one 24 hours after it was filed, an approved one 24 hours after the tap */
  expires_at?: string
  /** B57.11 — what pays it, with its balance now; null on one filed before Lens kept it */
  paid_from?: ApprovalPaidFrom | null
  /** B57.11 — the approval amount it was above, and the monthly limit less the month's spend and this amount; null with
   * no monthly limit, and both null on one filed before Lens kept them */
  asks_above_ulxc?: number | null
  budget_left_after_ulxc?: number | null
  /** B59.22 — 'card_challenge' for a 3-D Secure check on the agent's card, decided only signed; absent for the agent's own */
  kind?: 'card_challenge'
}

/** Lens economy.PaidFrom (B57.11): what pays an approval, named in words, its amount in that currency and its balance now. */
export interface ApprovalPaidFrom {
  kind: 'lxc' | 'account' | 'marketplace_bill' | 'card'
  account_id: string
  name: string
  currency: string
  amount_minor: number
  /** µLXC for an agent's LXC balance, minor units for an account; null for the bill and a card */
  balance_minor: number | null
}

/** Lens economy.StatementLine. */
export interface StatementLine {
  posting_id: number
  entry_id: string
  at: string
  account: string
  kind: string
  amount_ulxc: number
  counterparty: string
  balance_after_ulxc: number
  label?: string
  memo?: string
  /** the model a question's posting was for; empty on every other posting */
  model?: string
  /** B57.13 — on a statement read by day: the day a model's line covers, in the statement's time zone, and how many
   * questions it is */
  day?: string
  requests?: number
}

/** Lens economy.Statement: every agent wallet a workspace has over [from, to). */
export interface Statement {
  from: string
  to: string
  accounts: { account: string; opening_ulxc: number; in_ulxc: number; out_ulxc: number; closing_ulxc: number }[] | null
  lines: StatementLine[] | null
  /** "day" when the lines are read by model and day (B57.13), time_zone the zone those days are counted in */
  group?: string
  time_zone?: string
}

/** A model the deployment offers, as Lens's catalog names it. */
export interface CatalogModel {
  id: string
  display_name?: string
}

/** A statement file's type: the CSV, the JSON or the PDF Lens writes, or the period as a CSV of double-entry journal
 * lines Xero and QuickBooks import (the web's StatementFormat). */
export type StatementFormat = 'csv' | 'json' | 'pdf' | 'journal'

const STATEMENT_ACCEPT: Record<StatementFormat, string> = { csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', journal: 'text/csv' }

/** Lens economy.WorkspaceAccount (B59.6): who the account is for and the kind of money it holds, both set when it is made. */
export interface WorkspaceAccount {
  workspace_id: string
  account_type: 'business' | 'personal'
  money_kind: 'fiat' | 'stablecoin' | 'hybrid'
}

/** B61.60 — the workspace's plan as Lens has it (the BFF's GET /api/plan, suite B61.59): its id and its name as people
 * read it, the ladder it is chosen from, whether a contract sets it, its monthly price in minor units by currency (null
 * on Custom, which a contract prices), the agents it takes (-1 is unlimited), the agents it has, and its people. */
export interface WorkspacePlan {
  plan: string
  name?: string
  account_type?: 'personal' | 'business'
  on_contract?: boolean
  price_minor?: Record<string, number> | null
  agents: number
  agents_used: number
  seats: number
}

/** B61.60 — one plan of a ladder, as Lens's GET /v1/public/plans states it (Lens B61.57). -1 is unlimited. */
export interface LadderPlan {
  id: string
  /** Solo, Crew, Fleet, Studio, Company, Group or Custom. */
  name: string
  /** The monthly price in minor units, by currency; null on Custom, which a contract prices. */
  price_minor: Record<string, number> | null
  by_contract?: boolean
  agents: number
  people: number
}

/** B61.60 — both ladders, each from the smallest plan up, and the currencies they are priced in. */
export interface PlanLadders {
  currencies: string[]
  /** The currency a stablecoin account pays its plan in. */
  stablecoin_priced_in: string
  personal: LadderPlan[]
  business: LadderPlan[]
}

/** B61.60 — the public pricing's ladders and each plan's exchange fee (basis points over the reference rate, by plan),
 * each left out when Lens did not state it whole. */
export interface PlanPricing {
  ladders?: PlanLadders
  fees?: { fx_margin_bps?: Record<string, number> }
}

/** Lens economy.CurrencyAccount:the company's or an agent's account in one currency, in minor units. */
export interface CurrencyAccount {
  id: string
  /** "" for the company's own */
  agent_id?: string
  currency: string
  purpose: 'company' | 'agent'
  status: string
  name: string
  balance_minor: number
}

/** B59.26 — Lens economy.MoneyStatementLine (B56.14): one posting to a currency account, money in positive, out negative. */
export interface MoneyStatementLine {
  entry_id: string
  line: number
  at: string
  /** the entry's: payment_in, card_charge, card_refund, card_dispute_won, … */
  kind: string
  amount_minor: number
  counterparty: string
  memo?: string
  /** on a card_charge: the issuer's id for the payment, which a dispute names */
  partner_ref?: string
  balance_after_minor: number
}

/** B59.26 — Lens economy.MoneyStatement: one currency account over [from, to). */
export interface MoneyStatement {
  account_id: string
  agent_id?: string
  currency: string
  from: string
  to: string
  lines: MoneyStatementLine[] | null
}

/** B59.26 — where a card dispute stands (Lens economy.CardDispute*). */
export type CardDisputeStatus = 'opened' | 'with_issuer' | 'won' | 'lost'

/** B59.26 — Lens economy.CardDispute: one dispute of a card payment, named by the issuer's id for the payment. */
export interface CardDispute {
  id: string
  payment_id: string
  agent_id?: string
  card_id: string
  merchant: string
  amount_minor: number
  currency: string
  reason: string
  status: CardDisputeStatus
  /** what came back of the payment: the payment once won, else 0 */
  credited_minor: number
  decided_at?: string
  created_at: string
}

/** B59.26 — Lens economy.CardPaymentRefund: a merchant's refund of a card payment, and what it credited. */
export interface CardRefund {
  id: string
  payment_id: string
  agent_id?: string
  card_id: string
  merchant: string
  /** what the merchant refunded */
  amount_minor: number
  currency: string
  /** what came back: no more than was left of the payment */
  credited_minor: number
  created_at: string
}

/** B59.55 — where a card spend stands (Lens economy.CardSpend*). */
export type CardSpendStatus = 'asked' | 'awaiting_approval' | 'issuing' | 'active' | 'expired' | 'failed'

/** B59.55 — Lens economy.CardSpend (B59.21): an agent's ask to pay a merchant by card, on a one-time card for the amount
 * or by raising a standing card's limit for it. The amount is the budget the owner approved. */
export interface CardSpend {
  id: string
  agent_id: string
  merchant: string
  amount_minor: number
  currency: string
  /** the standing card whose limit it raises; absent for a one-time card */
  standing_card_id?: string
  status: CardSpendStatus
  /** the approval it waits on in Approvals */
  approval_id?: string
  detail?: string
  /** the one-time card, once issued */
  card?: { id: string; merchant: string; cap_minor: number; currency: string; status: string; last4?: string; expires_at?: string }
  /** when a standing card's raise ends */
  expires_at?: string
  created_at: string
}

/** Lens economy.OutsidePayee (B30.16): a saved payee outside Talyvor. */
export interface OutsidePayee {
  id: string
  name: string
  country: string
  /** a close or no match cannot be paid until the owner confirms it with a passkey */
  needs_confirmation: boolean
  /** read only for the payee's own currency; never shown or read aloud */
  iban?: string
  routing_number?: string
  account_number?: string
  /** set while screening holds the payee for an operator */
  screening?: string
  /** B59.20 — a payee paid at a wallet: its network and address (Lens B46); none for a bank account */
  network?: string
  address?: string
  /** B59.33 — a bank of the owner's own, the one Wallets withdraws to (Lens B59.51) */
  own?: boolean
  created_at: string
}

/** B59.33 — a withdrawal from a company account to a bank saved as the owner's own (Lens economy.Withdrawal). */
export interface WithdrawalRequest {
  payee_id: string
  amount_minor: number
}

/** B59.33 — Lens economy.Conversion between the company's two sides (B59.51): sell_minor leaves, the fee (margin) included. */
export interface SideConversion {
  id: string
  sell_minor: number
  sell_currency: string
  margin_minor: number
  buy_minor: number
  buy_currency: string
  /** what the owner gets, the margin taken, in whole units */
  rate: string
  status: string
  expires_at: string
}

/** B59.20 — who an Instant transfer pays (Lens economy.InstantTo…): a Talyvor account, an outside wallet or a bank account. */
export type InstantTo = 'talyvor_account' | 'wallet' | 'bank_account'

/** Lens economy.InstantQuoteRequest (B59.14): every amount in minor units. A bank account names its country. */
export interface InstantQuoteRequest {
  send_minor: number
  send_currency: string
  receive_currency: string
  to: InstantTo
  country: string
}

/** Lens economy.InstantQuote (B59.14), locked until expires_at. send_minor includes the fee; receive_minor is what arrives. */
export interface InstantQuote {
  id: string
  to: InstantTo
  country?: string
  send_minor: number
  send_currency: string
  fee_minor: number
  /** receive_currency per send_currency after the fee, in whole units */
  rate: string
  receive_minor: number
  receive_currency: string
  arrives_in_seconds: boolean
  /** the bank rail's real time when it does not land in seconds */
  arrives_within_seconds?: number
  expires_at: string
  created_at: string
}

/** A send against a quote: to a Talyvor account by its id, or to a saved payee (a wallet or a bank account). */
export interface InstantSend {
  quote_id: string
  to_account_id?: string
  to_payee_id?: string
}

/** Lens economy.InstantLeg: convert, move, then credit or payout; a direct bank payment has the payout alone. */
export interface InstantLeg {
  id: string
  leg: 'convert' | 'move' | 'credit' | 'payout'
  done: boolean
  entry_id?: string
  /** the provider's reference: the move leg's is the on-chain reference */
  partner_ref?: string
  conversion_ref?: string
  sell: { minor: number; currency: string }
  buy: { minor: number; currency: string }
}

/** Lens economy.InstantTransfer (B59.15): where it stands, and the receipt. */
export interface InstantTransfer {
  id: string
  agent_id: string
  from_account_id: string
  to_account_id?: string
  to_payee_id?: string
  to_address?: string
  beneficiary_name: string
  send_minor: number
  send_currency: string
  fee_minor: number
  receive_minor: number
  receive_currency: string
  rate: string
  arrives_in_seconds: boolean
  arrives_within_seconds?: number
  status: 'sent' | 'converted' | 'on_its_way' | 'received' | 'reversed'
  legs: InstantLeg[] | null
  failed_leg?: string
  failure?: string
  created_at: string
  updated_at: string
}

/** Lens economy.OutsidePayment (B30.17): money sent to a saved payee. */
export interface OutsidePayment {
  id: string
  payee_id: string
  payee_name: string
  amount_minor: number
  currency: string
  reference: string
  /** pending | sent | completed | failed | returned */
  status: string
  detail?: string
  created_at: string
}

/** Lens economy.DeviceKey (B40.4): a phone's approval key. */
export interface DeviceKey {
  id: string
  platform: string
  name: string
  person: string
  created_at: string
  last_used_at?: string
  revoked_at?: string
  /** B55.55: answered once, with the workspace's first key (Lens B55.48). */
  recovery_code?: string
}

/** B59.39 — a key that approves for the workspace, as Lens lists them (B55.15): a passkey by its credential id, a phone
 * key by its device id. */
export interface ApprovalKey {
  kind: 'passkey' | 'phone'
  id: string
  name: string
  platform: string
  created_at: string
  last_used_at?: string
}

/** B55.55 — a recovery started without the code (Lens economy.KeyRecovery): a key can be added from ready_at. */
export interface KeyRecovery {
  id: string
  status: 'waiting' | 'cancelled' | 'completed' | 'expired'
  created_at: string
  ready_at: string
  expires_at: string
  /** started by the person asking, who alone adds its key */
  mine: boolean
}

/** A payment to a saved payee, exactly as it is asked a challenge for and then sent. */
export interface OutsidePaymentRequest {
  account_id: string
  payee_id: string
  amount_minor: number
  currency: string
  reference: string
  idempotency_key: string
}

/** Lens economy.KeyEnrolment (B55.1): a key registered unsigned in a workspace that has one, waiting for a key the workspace
 * has to let it in. `code` is the six digits both devices show. */
export interface KeyEnrolment {
  id: string
  /** passkey | device */
  kind: string
  name: string
  platform?: string
  code: string
  /** waiting | approved | declined | expired */
  status: string
  created_at: string
  expires_at: string
}

/** A device key's signature, where Lens takes an approval's, a mandate's or a payment's assertion (B40.4). */
export interface DeviceAssertion {
  device_id: string
  challenge: string
  signature: string
}

/** Lens economy.PaymentRequest (B40.3): payments prepared for the owner, each with its decision and the rule that made it. */
export interface PaymentRequest {
  id: string
  /** pending_approval | auto | blocked | approved | cancelled | expired */
  status: string
  summary: string
  client: string
  agent_id?: string
  totals: Record<string, number>
  items: PaymentRequestItem[]
  created_at: string
  /** When it was approved, declined or expired (B57.148); a request still waiting has none. */
  decided_at?: string
}

export interface PaymentRequestItem {
  position: number
  payee_id: string
  payee_name: string
  listing_id?: string
  currency: string
  amount_minor: number
  reference: string
  /** auto | needs_approval | blocked */
  decision: string
  reason: string
  rule?: string
  /** pending | sent | completed | failed | returned | refused | not_approved | not_paid | held */
  pay_status?: string
  pay_detail?: string
}

/** Lens economy.ApprovalStatement (B40.5): exactly what the approval signs. */
export interface ApprovalStatement {
  request_id: string
  items: { position: number; payee_id: string; currency: string; amount_minor: number; reference: string }[] | null
  totals: Record<string, number>
  expires_at: string
}

/** What the BFF answers a phone's sign-in: a session token for the Authorization header. */
/** Lens economy.SpendPayment (B53.3): one payment and the category it reads in. */
export interface SpendPayment {
  entry_id: string
  kind: string
  merchant: string
  /** "": the owner's own wallet */
  agent_id?: string
  amount_minor: number
  currency: string
  category: string
  created_at: string
}

/** Lens economy.Spending: the payments in [from, to), newest first, and each wallet's totals per currency. */
export interface Spending {
  from: string
  to: string
  payments: SpendPayment[] | null
  totals: { agent_id?: string; currency: string; total_minor: number; by_category: Record<string, number> | null }[] | null
}

/** Lens economy.SpendBudget (B53.4): a weekly or monthly budget and how far this period has gone. */
export interface SpendBudget {
  id: string
  /** "": the owner's own wallet; "all": every wallet together; else an agent's */
  agent_id: string
  /** "": all spending */
  category: string
  period: 'week' | 'month'
  amount_minor: number
  currency: string
  spent_minor: number
  /** below zero once it is over */
  left_minor: number
  percent: number
}

/** Lens economy.SpendSubscription: a payment that recurs, to one merchant for one amount. */
export interface SpendSubscription {
  agent_id?: string
  merchant: string
  category: string
  amount_minor: number
  currency: string
  interval: 'weekly' | 'monthly'
  next_at: string
  yearly_minor: number
}

/** Lens economy.SpendFinding (B53.5): one payment a rule found unusual. */
export interface SpendFinding {
  rule: string
  entry_id?: string
  agent_id?: string
  merchant?: string
  category?: string
  amount_minor?: number
  currency?: string
  at: string
}

/** Lens economy.CoachLine (B53.6): one sentence and the fact it words. */
export interface CoachLine {
  fact: { kind: string; merchant?: string; category?: string }
  sentence: string
  help?: { name: string; url: string; for: string }[]
}

/** Lens economy.SpendNoticeSettings (B53.7). */
export interface NoticeSettings {
  timezone: string
  quiet_from: string
  quiet_until: string
  off: string[] | null
}

/** Lens economy.SpendNotice (B53.7): a payment's and an unusual payment's `data` name its `entry_id`. */
export interface SpendNotice {
  id: string
  kind: string
  title: string
  body: string
  data?: { entry_id?: string; agent_id?: string; rule?: string } | null
  status: 'waiting' | 'sent' | 'dropped'
  held?: string
  created_at: string
}

/** Lens economy.CapabilityStatus (B22.1): one money capability the workspace has, and (B56.7) whether it moves real money
 * for this workspace: label is "live" or "sandbox", on each capability that moves money. */
export interface WalletCapability {
  capability: string
  name: string
  class: 'GREEN' | 'AMBER' | 'RED'
  real_money: boolean
  label?: string
}

export interface MobileSession {
  token: string
  expires_at: string
}

/** B59.9 — what sign-up asks before the identity provider (suite B59.8): the BFF sends them to Lens when it makes the
 * workspace, and refuses a set that lacks one. Signing in sends none. */
export interface SignupAnswers {
  account_type: 'personal' | 'business'
  money_kind: 'fiat' | 'stablecoin' | 'hybrid'
  /** the person's name or the company's: the workspace's name */
  name: string
}

/** B61.10 — one of the signed-in person's accounts, as the BFF's GET /api/accounts lists it (suite B61.8, over Lens
 * B61.7): the first one opened first, the session's marked. A test session's one account says no type, kind or name. */
export interface PersonAccount {
  id: string
  name: string
  type: WorkspaceAccount['account_type'] | ''
  kind: WorkspaceAccount['money_kind'] | ''
  opened_at: string
  current: boolean
}

/** B61.10 — sign-up's answers for another account (the BFF's parseSignupAccount). */
export interface OpenAccountAnswers {
  type: WorkspaceAccount['account_type']
  kind: WorkspaceAccount['money_kind']
  name: string
  country: string
  registration_number?: string
}

/** B61.10 — the session moved to another account: the phone sends the new token from then on, the old one is ended. */
export interface AccountMove extends MobileSession {
  account_id: string
}

export class BffError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly sentence: string,
    /** the code an upstream gave with its refusal, as Track's MEMBER_EXISTS */
    readonly code = '',
    /** B59.20 — the field a refusal names, as Lens's may_instant_transfer: the screen picks its words from it */
    readonly field = '',
  ) {
    super(`${status} ${path}${sentence ? `: ${sentence}` : ''}`)
  }
}

/** B59.29 — closing the account was refused: what each currency still holds, in minor units (Lens B59.27). */
export class BalancesHeldError extends BffError {
  constructor(
    path: string,
    sentence: string,
    readonly balances: Record<string, number>,
  ) {
    super(409, path, sentence)
  }
}

/** B59.29 — help and complaints, closing the account and the workspace's data: each a request a person at Talyvor
 * answers (Lens B59.27, through the BFF's workspace_requests.go, suite B59.28). */
export type RequestKind = 'support' | 'complaint' | 'account_closure' | 'data_export' | 'data_deletion'

export interface AccountRequest {
  id: number
  kind: RequestKind
  state: 'received' | 'in_progress' | 'done'
  /** a complaint's, e.g. C-ABCD-EFGH; "" for every other kind */
  reference: string
  message: string
  /** what Talyvor wrote back; "" until then */
  answer: string
  filed_at: string
  updated_at: string
}

/** B61.39 — the Help chat (suite B61.38, the BFF's help_chat.go): who wrote a line is the person, Help's AI, or a person
 * on Talyvor's team, who answers in the same chat later. */
export type HelpBy = 'you' | 'ai' | 'team'

export interface HelpMessage {
  by: HelpBy
  text: string
  /** a page of the app that answers it, as the web names it (/approvals, /settings/data, …) */
  page?: string
  /** the reply offers "Send to our team" */
  team?: boolean
  /** "complaint": the reply offers the complaints form instead */
  topic?: string
  at: string
}

/** The day's questions were all asked: the BFF's sentence, and the chat with the question in it. */
export class HelpLimitError extends BffError {
  constructor(
    path: string,
    sentence: string,
    readonly messages: HelpMessage[],
  ) {
    super(429, path, sentence)
  }
}

/** B59.32 — a Business workspace's company details and the people with control, for the partner's identity check later
 * (Lens B59.30, through the BFF's workspace_business.go, suite B59.31). No identity document is asked for. */
export type ControlRole = 'director' | 'shareholder' | 'other'

/** One person with control; share_bps is their share in hundredths of a percent (2500 is 25%). */
export interface ControlPerson {
  name: string
  role: ControlRole
  share_bps: number
}

export interface CompanyDetails {
  company_name: string
  registration_number: string
  country: string
  people: ControlPerson[]
}

/** B61.21 — Lens economy.VerificationCheck (B30.4), through the BFF's /api/verification (suite B30.116): one check, as the
 * provider that made it answered. */
export interface VerificationCheck {
  level: string
  subject: string
  /** The provider that checked. */
  method: string
  /** Checked by the Test provider: it counts in Sandbox only. */
  test: boolean
  status: 'pending' | 'completed' | 'failed' | 'returned'
  evidence_ref: string
  verified_name?: string
  country?: string
  company_number?: string
  detail?: string
}

/** Lens economy.WorkspaceVerification (B30.4): the level the checks reach, the level live money is judged by, every check. */
export interface WorkspaceVerification {
  level: string
  meaning: string
  live_level: string
  live_meaning: string
  checks: VerificationCheck[] | null
}

/** What a check answers: the check, and the record after it. */
export interface VerificationAnswer {
  check: VerificationCheck
  verification: WorkspaceVerification
}

/** What each level's check is asked to confirm (Lens economy.VerificationRequest). */
export type VerificationBody =
  | { kind: 'contact'; email: string; phone: string }
  | { kind: 'identity'; name: string; country: string; date_of_birth: string }
  | { kind: 'company'; name: string; country: string; company_number: string; directors: string[]; people_with_significant_control: string[] }

const VERIFY_PATH: Record<VerificationBody['kind'], string> = {
  contact: '/api/verification/contact',
  identity: '/api/verification/identity',
  company: '/api/verification/company',
}

/** B59.39 — Track's memberView: a person in the workspace and their role. */
export type MemberRole = 'owner' | 'member'

export interface Member {
  id: string
  name: string
  email: string
  role: MemberRole
  avatar_url: string
}

const e = encodeURIComponent

export function createBffClient(baseUrl: string, token: () => string | null, fetchImpl: typeof fetch = fetch) {
  async function send(method: string, path: string, body: string | FormData | undefined, headers: Record<string, string>): Promise<Response> {
    const t = token()
    if (t) headers.Authorization = `Bearer ${t}`
    const res = await fetchImpl(baseUrl + path, { method, headers, body })
    if (!res.ok) {
      let body: { error?: string; code?: string; field?: string; balances?: Record<string, number>; messages?: HelpMessage[] | null } = {}
      try {
        body = (await res.json()) as typeof body
      } catch {
        // a body that is not JSON carries no sentence
      }
      if (res.status === 409 && body.code === 'balances_not_empty' && body.balances) throw new BalancesHeldError(path, body.error ?? '', body.balances)
      if (res.status === 429 && path === '/api/help/ask') throw new HelpLimitError(path, body.error ?? '', body.messages ?? [])
      throw new BffError(res.status, path, body.error ?? '', body.code ?? '', body.field ?? '')
    }
    return res
  }

  async function call<T>(method: string, path: string, body?: object, extra: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extra }
    if (body) headers['Content-Type'] = 'application/json'
    return (await (await send(method, path, body ? JSON.stringify(body) : undefined, headers)).json()) as T
  }

  let usdPerLXC: number | null = null

  return {
    /** USD per LXC, read once from the top-up options; null while Lens does not supply it or the read fails. */
    peg: async () => {
      if (usdPerLXC === null) usdPerLXC = (await call<{ usd_per_lxc?: number }>('GET', '/api/lxc/topup-options').catch(() => null))?.usd_per_lxc ?? null
      return usdPerLXC
    },
    /** Trades the identity provider's ID token, got in the system browser with PKCE, for a BFF session; with sign-up's
     * answers when the person is signing up. */
    signIn: (idToken: string, signup?: SignupAnswers) => call<MobileSession>('POST', '/auth/mobile/session', { id_token: idToken, ...signup }),
    /** B61.10 — the person's accounts, the session's marked current. */
    accounts: async () => (await call<{ accounts: PersonAccount[] | null }>('GET', '/api/accounts')).accounts ?? [],
    /** B61.10 — moves the session to another of the person's accounts; any other id is refused 404 and nothing moves. */
    switchAccount: (accountID: string) => call<AccountMove>('POST', '/api/accounts/switch', { account_id: accountID }),
    /** B61.10 — opens another account with sign-up's answers, and moves the session to it. */
    openAccount: (answers: OpenAccountAnswers) => call<AccountMove>('POST', '/api/accounts', answers),
    /** B61.88 — the day's euro reference rates, which open rules held in another currency in the account's. */
    fx: () => call<FXRates>('GET', '/api/fx'),
    /** Whose workspace this session is in. */
    me: () => call<{ workspace_id: string }>('GET', '/auth/me'),
    /** The workspace's name; Lens answers its id until it is named. */
    workspaceName: () => call<{ id: string; name: string }>('GET', '/api/workspace/name'),
    /** B57.128 — the workspace's type and kind of money (Lens B59.6). */
    account: () => call<WorkspaceAccount>('GET', '/api/workspace/account'),
    /** B61.60 — the plan Lens has the workspace on, what it takes and what it has (suite B61.59's GET /api/plan). */
    plan: () => call<WorkspacePlan>('GET', '/api/plan'),
    /** B61.60 — the owner moves the account to another plan of its own ladder; Lens decides, and refuses in its words. */
    changePlan: (plan: string) => call<{ from: string; plan: string; name: string }>('PUT', '/api/plan', { plan }),
    /** B61.60 — the ladders and their exchange fees, from the public pricing (Lens's GET /v1/public/plans and fees). */
    planPricing: async (): Promise<PlanPricing> => {
      const got = await call<PlanPricing>('GET', '/api/pricing')
      return { ladders: got.ladders, fees: got.fees }
    },
    /** B59.3 — the areas the operator switched on for this workspace (Lens B59.1); none until then. */
    areas: async () => (await call<{ areas: string[] | null }>('GET', '/api/workspace/areas')).areas ?? [],
    book: () => call<AgentBook>('GET', '/api/agents'),
    /** B61.37 — a new agent with the name its owner typed and its picture's colour (Lens picks one without); with
     * fiat_currency (GBP, EUR or USD) its own account opens in that currency, as the web's New agent does (B61.87). */
    createAgent: (name: string, colour?: string, fiat_currency?: string) =>
      call<Agent>('POST', '/api/agents', { name, ...(colour ? { colour } : {}), ...(fiat_currency ? { fiat_currency } : {}) }),
    /** B61.37 — what the agent does, in the owner's words. */
    describeAgent: (id: string, description: string) => call<Agent>('PATCH', `/api/agents/${e(id)}`, { description }),
    approvals: () => call<{ approvals: AgentApproval[] | null }>('GET', '/api/agents/approvals'),
    /** The challenge approving or declining one approval is signed over. */
    approvalChallenge: (id: string) => call<{ challenge: string }>('POST', `/api/agents/approvals/${e(id)}/challenge`),
    // Without an assertion Lens says whether this workspace may decide without one.
    approve: (id: string, assertion?: DeviceAssertion) =>
      call<AgentApproval>('POST', `/api/agents/approvals/${e(id)}/approve`, assertion ? { assertion } : undefined),
    /** B55.18 — `reason`, up to 200 characters, is kept on the approval and told to the agent. */
    deny: (id: string, assertion?: DeviceAssertion, reason?: string) =>
      call<AgentApproval>('POST', `/api/agents/approvals/${e(id)}/deny`, assertion || reason ? { assertion, reason: reason || undefined } : undefined),
    /** Every agent's next request or payment is refused until resume-all; each agent's own pause stays as it was. */
    pauseAll: (reason: string) => call<{ all_paused: boolean }>('POST', '/api/agents/pause-all', { reason }),
    /** The challenge resume-all, or resume(id), is signed over once the workspace has a passkey or phone key (B55.5). */
    resumeAllChallenge: () => call<{ challenge: string }>('POST', '/api/agents/resume-all/challenge'),
    resumeChallenge: (id: string) => call<{ challenge: string }>('POST', `/api/agents/${e(id)}/resume-challenge`),
    resumeAll: (assertion?: DeviceAssertion) => call<{ all_paused: boolean }>('POST', '/api/agents/resume-all', assertion ? { assertion } : undefined),
    /** B57.70 — everything an agent's page shows, in one read: this month's spend, what waits, its card. */
    summary: (id: string) => call<AgentSummary>('GET', `/api/agents/${e(id)}/summary`),
    rules: (id: string) => call<AgentRules>('GET', `/api/agents/${e(id)}/rules`),
    /** B59.44 — what saving these rules would do, and the challenge a looser save is signed over; saves nothing. */
    rulesChallenge: (id: string, rules: AgentRulesSave) => call<RulesJudgement>('POST', `/api/agents/${e(id)}/rules-challenge`, { rules }),
    /** B59.44 — saves the agent's rules whole; a looser save carries the phone's signature over rulesChallenge's challenge. */
    setRules: (id: string, rules: AgentRulesSave, assertion?: DeviceAssertion) =>
      call<AgentRules>('PUT', `/api/agents/${e(id)}/rules`, assertion ? { rules, assertion } : rules),
    /** B59.20 — Instant transfer, for a Hybrid account (Lens B59.14 to B59.17, the BFF's instant_transfer.go): a quote
     * locked for 30 seconds, the send from an agent's account under a key a retry sends again, and the receipt. */
    instantQuote: (body: InstantQuoteRequest) => call<InstantQuote>('POST', '/api/money/instant-transfers/quote', body),
    instantSend: (agentId: string, body: InstantSend, key: string) =>
      call<InstantTransfer>('POST', `/api/agents/${e(agentId)}/instant-transfers`, body, { 'Idempotency-Key': key }),
    instantTransfer: (id: string) => call<InstantTransfer>('GET', `/api/money/instant-transfers/${e(id)}`),
    /** B59.44 — issues the agent a virtual card to `holder`; Lens answers the card. */
    issueCard: (id: string, holder: Cardholder) => call<AgentCard>('POST', `/api/agents/${e(id)}/card`, holder),
    /** B59.34 — the agent's card and every purchase on it; null when it has none (Lens answers 404). */
    card: async (id: string) => {
      try {
        return await call<{ card: AgentCard; authorizations: CardAuthorization[] | null }>('GET', `/api/agents/${e(id)}/card`)
      } catch (err) {
        if (err instanceof BffError && err.status === 404) return null
        throw err
      }
    },
    freezeCard: (id: string) => call<AgentCard>('POST', `/api/agents/${e(id)}/card/freeze`),
    unfreezeCard: (id: string) => call<AgentCard>('POST', `/api/agents/${e(id)}/card/unfreeze`),
    pause: (id: string, reason: string) => call<Agent>('POST', `/api/agents/${e(id)}/pause`, { reason }),
    resume: (id: string, assertion?: DeviceAssertion) => call<Agent>('POST', `/api/agents/${e(id)}/resume`, assertion ? { assertion } : undefined),
    /** Moves µLXC from the workspace's unallocated balance to the agent; `key` makes a retry move it once. */
    fund: (id: string, amount_ulxc: number, key: string) =>
      call<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/fund`, { amount_ulxc }, { 'Idempotency-Key': key }),
    /** Every agent wallet's statement for [from, to), YYYY-MM-DD at midnight UTC. */
    statement: (from: string, to: string) =>
      call<Statement>('GET', `/api/agents/statement?${new URLSearchParams({ from, to, format: 'json' })}`),
    /** B57.73 — the same statement with its lines by model and day (Lens B57.13): each model's questions on a day one
     * line, its platform fee the line under it, newest first. */
    statementByDay: (from: string, to: string) =>
      call<Statement>('GET', `/api/agents/statement?${new URLSearchParams({ from, to, format: 'json', group: 'day' })}`),
    /** The models the deployment offers, to name a statement's model lines. */
    models: () => call<CatalogModel[] | null>('GET', '/api/models'),
    /** B59.35 — the statement for [from, to) as the file Lens writes (the web's Download, suite B28.55): one agent's, or
     * with no agent every agent's. */
    statementFile: async (agentId: string | null, from: string, to: string, format: StatementFormat) => {
      const query = new URLSearchParams({ from, to, format })
      const path = agentId ? `/api/agents/${e(agentId)}/statement?${query}` : `/api/agents/statement?${query}`
      return (await send('GET', path, undefined, { Accept: STATEMENT_ACCEPT[format] })).arrayBuffer()
    },
    moneyAccounts: () => call<{ accounts: CurrencyAccount[] | null }>('GET', '/api/money/accounts'),
    payees: () => call<{ payees: OutsidePayee[] | null }>('GET', '/api/money/payees'),
    // B59.33 — Wallets (the web's B59.53, through the BFF's B59.52 to Lens B17.255 and B59.51): Sandbox money into a company
    // account, a withdrawal to a bank of the owner's own and a conversion between the two sides, each once under its key and
    // the last two signed over a challenge that names that key.
    walletTopUp: (accountId: string, amount_minor: number, key: string) =>
      call<unknown>('POST', `/api/money/accounts/${e(accountId)}/top-up`, { amount_minor }, { 'Idempotency-Key': key }),
    walletWithdrawChallenge: (accountId: string, body: WithdrawalRequest, key: string) =>
      call<{ challenge: string; allow_credentials: string[] | null }>('POST', `/api/money/accounts/${e(accountId)}/withdraw/challenge`, body, { 'Idempotency-Key': key }),
    walletWithdraw: (accountId: string, body: WithdrawalRequest, key: string, assertion?: DeviceAssertion) =>
      call<OutsidePayment>('POST', `/api/money/accounts/${e(accountId)}/withdraw`, assertion ? { ...body, assertion } : body, { 'Idempotency-Key': key }),
    sideConvertQuote: (body: { sell_currency: string; buy_currency: string; sell_minor: number }) => call<SideConversion>('POST', '/api/money/convert/quote', body),
    sideConvertChallenge: (quote_id: string, key: string) =>
      call<{ challenge: string; allow_credentials: string[] | null }>('POST', '/api/money/convert/challenge', { quote_id }, { 'Idempotency-Key': key }),
    sideConvert: (quote_id: string, key: string, assertion?: DeviceAssertion) =>
      call<SideConversion>('POST', '/api/money/convert', assertion ? { quote_id, assertion } : { quote_id }, { 'Idempotency-Key': key }),
    // B59.26 — card disputes, refunds and the card export (the web's B59.25, on Lens B59.24). Lens decides whose payment
    // may be disputed and what a won dispute or a refund credits.
    /** One currency account's postings over [from, to), YYYY-MM-DD: its card payments carry the id a dispute names. */
    accountStatement: (id: string, from: string, to: string) =>
      call<MoneyStatement>('GET', `/api/money/accounts/${e(id)}/statement?${new URLSearchParams({ from, to })}`),
    /** The workspace's card disputes, newest first, and where each stands. */
    cardDisputes: async () => (await call<{ card_disputes: CardDispute[] | null }>('GET', '/api/money/card-disputes')).card_disputes ?? [],
    /** Disputes a card payment, named by the issuer's id for it, with the owner's reason. Lens answers the dispute. */
    openCardDispute: (paymentId: string, reason: string) => call<CardDispute>('POST', '/api/money/card-disputes', { payment_id: paymentId, reason }),
    /** The merchants' refunds on the workspace's card payments, newest first. */
    cardRefunds: async () => (await call<{ card_refunds: CardRefund[] | null }>('GET', '/api/money/card-refunds')).card_refunds ?? [],
    /** B59.55 — the agent's one-time and standing cards (B59.54, Lens B59.21), each with the budget the owner approved. */
    cardSpends: async (agentId: string) =>
      (await call<{ card_spends: CardSpend[] | null }>('GET', `/api/money/card-spends?${new URLSearchParams({ agent_id: agentId })}`)).card_spends ?? [],
    /** The card payments, disputes and refunds from one day to another, both included, as Lens's CSV. */
    cardExportFile: async (from: string, through: string) =>
      (await send('GET', `/api/money/card-exports?${new URLSearchParams({ from, to: through })}`, undefined, { Accept: 'text/csv' })).arrayBuffer(),
    /** The payments out, newest first. */
    payments: () => call<{ payments: OutsidePayment[] | null }>('GET', '/api/money/payments'),
    /** B54.36 — the challenge a person's payment is signed over, naming exactly this payment (Lens B54.33). */
    paymentChallenge: (body: OutsidePaymentRequest) =>
      call<{ challenge: string; allow_credentials: string[] | null }>('POST', '/api/money/payments/challenge', body),
    /** Pays a saved payee from one account; `idempotency_key` makes a retry pay once. Once the workspace has a key, Lens
     * pays it only with `assertion`, a signature over paymentChallenge's challenge for this same body. */
    pay: (body: OutsidePaymentRequest, assertion?: DeviceAssertion) =>
      call<OutsidePayment>('POST', '/api/money/payments', assertion ? { ...body, assertion } : body),
    devices: () => call<{ devices: DeviceKey[] | null }>('GET', '/api/money/devices'),
    /** The single-use challenge a new device key signs and binds its attestation to. */
    deviceChallenge: () => call<{ challenge: string }>('POST', '/api/money/devices/challenge'),
    /** Keeps this phone's key as the person's; every byte string is base64url. In a workspace that has a key, Lens keeps it
     * waiting instead (202) until a key the workspace has lets it in (B55.1). */
    registerDevice: (body: { platform: string; name: string; public_key: string; challenge: string; signature: string; attestation: string }) =>
      call<DeviceKey | { enrolment: Pick<KeyEnrolment, 'id' | 'code' | 'expires_at'> }>('POST', '/api/money/devices', body),
    /** B55.4 — the keys waiting to join the workspace, and letting one in or turning it away (Lens B55.1, BFF B55.3). */
    enrolments: () => call<{ enrolments: KeyEnrolment[] | null }>('GET', '/api/agents/keys/enrolments'),
    /** One enrolment, whatever its status. */
    enrolment: (id: string) => call<KeyEnrolment>('GET', `/api/agents/keys/enrolments/${e(id)}`),
    /** The challenge letting enrolment `id` in is signed over. */
    enrolmentChallenge: (id: string) => call<{ challenge: string }>('POST', `/api/agents/keys/enrolments/${e(id)}/challenge`),
    approveEnrolment: (id: string, assertion: DeviceAssertion) => call<KeyEnrolment>('POST', `/api/agents/keys/enrolments/${e(id)}/approve`, { assertion }),
    /** It can never be let in after. */
    declineEnrolment: (id: string) => call<KeyEnrolment>('POST', `/api/agents/keys/enrolments/${e(id)}/decline`),
    /** B55.55 — the recovery waiting in this workspace, or null, and cancelling it: Lens lets any owner or admin (B55.48,
     * BFF B55.54). */
    waitingRecovery: () => call<{ recovery: KeyRecovery | null }>('GET', '/api/agents/keys/recover'),
    cancelRecovery: () => call<{ recovery: KeyRecovery }>('POST', '/api/agents/keys/recover/cancel'),
    /** Revokes one device key: Lens refuses its signatures from then on, and never revokes the workspace's last key or
     * one that owns an agent's account (409, B55.15). */
    revokeDevice: (id: string) => call<DeviceKey>('POST', `/api/money/devices/${e(id)}/revoke`),
    /** B59.39 — every passkey and phone key that approves for the workspace, by name (Lens B55.15); the owner or an
     * admin alone may read them. */
    approvalKeys: async () => (await call<{ keys: ApprovalKey[] | null }>('GET', '/api/agents/keys')).keys ?? [],
    /** Removes one passkey (B55.16): Lens refuses the workspace's last key with its sentence. */
    removePasskey: (credentialID: string) => call<{ removed: boolean }>('DELETE', '/api/agents/passkeys', { credential_id: credentialID }),
    /** The APNs or FCM token Lens pushes this device's approvals to (B40.15). */
    setPushToken: (deviceId: string, push_token: string) => call<DeviceKey>('POST', `/api/money/devices/${e(deviceId)}/push-token`, { push_token }),
    /** Payments Chat prepared for the person to approve: Lens judges each and moves no money, and one said aloud always
     * waits for approval (B40.3, B40.12). */
    preparePayment: (voice: boolean, items: { payee_id: string; currency: string; amount_minor: number; reference: string }[], key: string) =>
      call<PaymentRequest>('POST', '/api/money/payment-requests', { voice, items }, { 'Idempotency-Key': key }),
    /** One Chat answer, on model "auto": Lens picks the cheapest model that answers well, and bills it like the web's Chat. */
    ask: async (messages: { role: 'user' | 'assistant'; content: string }[]) =>
      answerOf(
        await (
          await send('POST', '/api/ai/stream/openai/v1/chat/completions', JSON.stringify({ model: 'auto', stream: true, messages }), {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          })
        ).text(),
      ),
    /** The recording, as text, by Lens's transcription (B40.10); `form` holds it as "file". */
    transcribe: async (form: FormData) =>
      (((await (await send('POST', '/api/chat/voice/transcriptions', form, { Accept: 'application/json' })).json()) as { text?: string }).text ?? '').trim(),
    /** The words, spoken by Lens's speech: the audio and its type. */
    speech: async (input: string) => {
      const res = await send('POST', '/api/chat/voice/speech', JSON.stringify({ input }), { 'Content-Type': 'application/json' })
      return { audio: await res.arrayBuffer(), type: res.headers.get('Content-Type') ?? '' }
    },
    /** B58.10 — "Hey Taly"'s Picovoice access key for this signed-in person; null when the server has none ("Hey Taly
     * is off."). Keep it in memory only. */
    voiceKey: async () => {
      try {
        return (await call<{ access_key?: string }>('GET', '/api/voice/key')).access_key || null
      } catch (err) {
        if (err instanceof BffError && err.status === 503) return null
        throw err
      }
    },
    /** The requests waiting for the person's approval: the bills an assistant, Chat or an agent prepared for them. */
    pendingPaymentRequests: () => call<{ requests: PaymentRequest[] | null }>('GET', '/api/money/payment-requests?status=pending_approval'),
    /** B57.149 — the workspace's requests approved, declined or expired, newest decision first. */
    decidedPaymentRequests: () => call<{ requests: PaymentRequest[] | null }>('GET', '/api/money/payment-requests?status=decided'),
    paymentRequest: (id: string) => call<PaymentRequest>('GET', `/api/money/payment-requests/${e(id)}`),
    /** The statement approving exactly these items, which the approval signs. */
    requestApproval: (id: string, positions: number[]) =>
      call<{ statement: string; challenge: string }>('POST', `/api/money/payment-requests/${e(id)}/approval`, { positions }),
    /** Keeps the signed approval; Lens then pays each approved item once. */
    approveRequest: (id: string, statement: string, assertion: DeviceAssertion) =>
      call<PaymentRequest>('POST', `/api/money/payment-requests/${e(id)}/approve`, { statement, assertion }),
    /** Declines the whole request: nothing waiting in it is paid. */
    cancelRequest: (id: string) => call<PaymentRequest>('POST', `/api/money/payment-requests/${e(id)}/cancel`),
    // B53.9 — the web's Spending screen's reads (B53.8), every number from Lens.
    /** The payments in [from, to), RFC 3339, with each wallet's totals by category. */
    spending: (from: string, to: string) => call<Spending>('GET', `/api/money/spending?${new URLSearchParams({ from, to })}`),
    unusual: (from: string, to: string) =>
      call<{ findings: SpendFinding[] | null }>('GET', `/api/money/spending/unusual?${new URLSearchParams({ from, to })}`),
    budgets: () => call<{ budgets: SpendBudget[] | null }>('GET', '/api/money/budgets'),
    subscriptions: () => call<{ subscriptions: SpendSubscription[] | null }>('GET', '/api/money/spending/subscriptions'),
    coach: () => call<{ lines: CoachLine[] | null }>('GET', '/api/money/coach'),
    notices: () => call<{ settings: NoticeSettings; notices: SpendNotice[] | null }>('GET', '/api/money/notices'),
    setNoticeSettings: (s: NoticeSettings) => call<NoticeSettings>('PUT', '/api/money/notices/settings', s),
    // B56.12 — Live or Sandbox, as Lens answers it (talyvor-lens B56.7, through the BFF's B56.9 passthrough).
    /** The workspace's money capabilities, each with its label for this workspace. */
    capabilities: () => call<{ capabilities: WalletCapability[] | null }>('GET', '/api/wallets/capabilities'),
    /** The public pricing; its labels are Lens's public answer per capability, left out when Lens did not say. */
    pricingLabels: async () => (await call<{ labels?: Record<string, string> }>('GET', '/api/pricing')).labels,
    /** B59.29 — the workspace's requests, newest first: all of them for the owner, the ones they sent for anyone else. */
    requests: async () => (await call<{ requests: AccountRequest[] | null }>('GET', '/api/workspace/requests')).requests ?? [],
    /** Sends one request; a closure refused while the account holds money throws BalancesHeldError. */
    sendRequest: (kind: RequestKind, message: string) => call<AccountRequest>('POST', '/api/workspace/requests', { kind, message }),
    /** The data file of an export Talyvor has marked done. */
    /** B59.32 — the company details; null for a Personal workspace, which has none. */
    companyDetails: async (): Promise<CompanyDetails | null> => {
      try {
        const got = await call<CompanyDetails>('GET', '/api/workspace/business')
        return { ...got, people: got.people ?? [] }
      } catch (err) {
        if (err instanceof BffError && err.status === 404) return null
        throw err
      }
    },
    /** Saves the company details, replacing what was saved, and answers what Lens kept. */
    saveCompanyDetails: async (details: CompanyDetails) => {
      const got = await call<CompanyDetails>('PUT', '/api/workspace/business', details)
      return { ...got, people: got.people ?? [] }
    },
    /** B61.21 — the workspace's identity checks and the level they reach (Lens B30.4). */
    verification: () => call<WorkspaceVerification>('GET', '/api/verification'),
    /** Runs one level's check against the provider (the Test provider in Sandbox) and answers it with the record after. */
    verify: ({ kind, ...body }: VerificationBody) => call<VerificationAnswer>('POST', VERIFY_PATH[kind], body),
    /** B59.39 — the workspace's members and their roles (Track, through the BFF's track_members.go). */
    members: async () => (await call<Member[] | null>('GET', '/api/members')) ?? [],
    /** Adds a person by the email they sign in with; Track refuses with a code (MEMBER_EXISTS, OWNER_REQUIRED, …). */
    addMember: (email: string, role: MemberRole) => call<Member>('POST', '/api/members', { email, role }),
    /** B61.39 — the Help chat the BFF keeps for the workspace, 30 days. */
    helpChat: async () => (await call<{ messages: HelpMessage[] | null }>('GET', '/api/help/chat')).messages ?? [],
    /** Asks one question from `page`; answers the chat with the reply last. Past the day's questions: HelpLimitError. */
    askHelp: async (question: string, page: string) => (await call<{ messages: HelpMessage[] | null }>('POST', '/api/help/ask', { question, page })).messages ?? [],
    /** Files the chat so far in the help inbox, as Help's form does. */
    sendHelpToTeam: () => call<AccountRequest>('POST', '/api/help/team', {}),
    requestExport: async (id: number) => (await send('GET', `/api/workspace/requests/${id}/export`, undefined, { Accept: 'application/json' })).arrayBuffer(),
  }
}

export type BffClient = ReturnType<typeof createBffClient>

/** The answer in an OpenAI-shaped event stream, read whole; an error event is the refusal. */
export function answerOf(events: string): string {
  let text = ''
  for (const line of events.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (data === '' || data === '[DONE]') continue
    const frame = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } | string }
    if (frame.error) throw new BffError(400, '/api/ai/stream', typeof frame.error === 'string' ? frame.error : (frame.error.message ?? ''))
    text += frame.choices?.[0]?.delta?.content ?? ''
  }
  return text.trim()
}

/** 45000, USD → `$450.00`; 1250, GBP → `£12.50`; USDC counts six decimals, so 1,500,000 → `1.50 USDC`. */
export function formatMinor(minor: number, currency: string): string {
  if (currency === 'USDC') return `${(minor / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`
  return (minor / 100).toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// B61.15 — Nick, 15 Nov: "get rid of the lxc at all for now ... it should only be in the actual account currency only."
// What Lens still counts in µLXC is written in the dollars it is worth at the peg, and never beside its LXC.

/** 900,000,000 µLXC at 0.1 USD per LXC → `$90.00`; `Reading…` while the peg is unread, as the phone says of any read. */
export function formatLXC(micros: number, peg: number | null): string {
  return writeLXC(micros, peg, Math.round)
}

/** B59.36 — a balance as formatLXC writes it, its dollars rounded down to the cent: 1,255,000 µLXC at 0.1 → `$0.12`. */
export function formatBalance(micros: number, peg: number | null): string {
  return writeLXC(micros, peg, Math.floor)
}

function writeLXC(micros: number, peg: number | null, toCents: (cents: number) => number): string {
  if (!peg) return 'Reading…'
  // Whole µUSD first, so 0.1's float error never pulls an exact cent down a cent.
  return formatMinor(toCents(Math.round(micros * peg) / 10_000), 'USD')
}

/** B61.15 — dollars typed, as the µLXC Lens counts at the peg: `12.34` at 0.1 → 123,400,000, which formatLXC writes back
 * as `$12.34`; null for anything that is not a positive amount with at most 2 decimals, and while the peg is unread. */
export function parseDollars(text: string, peg: number | null): number | null {
  const cents = parseMinor(text)
  if (cents === null || !peg) return null
  const micros = Math.round((cents * 10_000) / peg)
  return micros > 0 && Number.isSafeInteger(micros) ? micros : null
}

/** µLXC as the dollars to type in a field: 123,400,000 at 0.1 → `12.34`, 250,000,000 → `25`; empty for none. */
export function dollarsText(micros: number | undefined, peg: number | null): string {
  if (!micros || micros <= 0 || !peg) return ''
  return String(Math.round(Math.round(micros * peg) / 10_000) / 100)
}

/** `12.5` → 1250 minor units; null for anything that is not a positive amount with at most 2 decimals. */
export function parseMinor(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return null
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return minor > 0 && Number.isSafeInteger(minor) ? minor : null
}

/** B59.33 — "12.50" → 1250, or for USDC (six places) 12500000: a typed amount in the currency's minor units; null when
 * not positive. The web's Wallets reads amounts the same way (amountMinor in talyvor-suite Wallets.tsx). */
export function amountMinor(text: string, currency: string): number | null {
  const places = currency === 'USDC' ? 6 : 2
  const m = new RegExp(`^\\s*(\\d+)(?:\\.(\\d{1,${places}}))?\\s*$`).exec(text)
  if (m === null) return null
  const minor = Number(m[1]) * 10 ** places + Number((m[2] ?? '').padEnd(places, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

/** What the owner can still spend: the workspace's balance less every approval still waiting. */
export function safeToSpend(book: AgentBook, approvals: AgentApproval[]): number {
  const held = approvals.filter((a) => a.status === 'pending').reduce((sum, a) => sum + a.amount_ulxc, 0)
  return Math.max(0, book.workspace_balance_ulxc - held)
}

/** The agent's rules as sentences a person reads; a zero limit or an empty list is no rule and says nothing. */
export function rulesInWords(r: AgentRules, peg: number | null = null): string[] {
  const out: string[] = []
  // B61.88 — each limit in the rules' own currency, as Lens holds it; rules Lens gives no currency, in dollars at the peg.
  const limit = (f: MinorLimit, words: (amount: string) => string) => {
    const v = r.currency ? (r[f] ?? 0) : (r[ULXC_OF[f]] ?? 0)
    if (v > 0) out.push(words(r.currency ? formatMinor(v, heldIn(r)) : formatLXC(v, peg)))
  }
  limit('max_per_payment_minor', (x) => `Spends at most ${x} on one request.`)
  limit('hourly_limit_minor', (x) => `Spends at most ${x} an hour.`)
  limit('daily_limit_minor', (x) => `Spends at most ${x} a day.`)
  limit('weekly_limit_minor', (x) => `Spends at most ${x} a week.`)
  limit('monthly_limit_minor', (x) => `Spends at most ${x} a month.`)
  limit('approval_above_minor', (x) => `Asks you first above ${x}.`)
  // B61.15: the requests-a-minute, model and provider rules are the parked gateway's, and are not drawn.
  if (r.allowed_payees?.length) out.push(`Pays only ${r.allowed_payees.length} named payee${r.allowed_payees.length === 1 ? '' : 's'}.`)
  if (r.blocked_payees?.length) out.push(`Never pays ${r.blocked_payees.length} blocked payee${r.blocked_payees.length === 1 ? '' : 's'}.`)
  if (r.active_from && r.active_until) out.push(`Works only from ${r.active_from} to ${r.active_until} (${r.timezone || 'UTC'}).`)
  return out.length ? out : ['No limits: it can spend everything it holds.']
}

// B61.88 — an agent's rules in the account's own currency, as the web's are (talyvor-suite rulesCurrency.ts, B61.87):
// Lens (B61.12) holds them in a currency, each amount limit in its minor units — pence, cents, and USDC to its six
// decimals. A save names the currency and every minor-unit limit and no µLXC limit, which Lens refuses on rules held in
// pounds or euros.

/** The currencies an agent's rules are held in, and the decimals of each one's minor units. */
export const RULES_DECIMALS: Readonly<Record<string, number>> = { GBP: 2, EUR: 2, USD: 2, USDC: 6 }

/** A currency in a sentence: "pounds". */
export const CURRENCY_WORDS: Readonly<Record<string, string>> = { GBP: 'pounds', EUR: 'euros', USD: 'dollars', USDC: 'USDC' }

/** The limits Lens holds in the rules' currency, as AgentRules names them. */
export type MinorLimit = 'max_per_payment_minor' | 'hourly_limit_minor' | 'daily_limit_minor' | 'weekly_limit_minor' | 'monthly_limit_minor' | 'approval_above_minor'

/** Each limit's µLXC form, which rules Lens gives no currency name alone: dollars at the peg. */
const ULXC_OF: Record<MinorLimit, 'max_per_request_ulxc' | 'hourly_limit_ulxc' | 'daily_limit_ulxc' | 'weekly_limit_ulxc' | 'monthly_limit_ulxc' | 'approval_above_ulxc'> = {
  max_per_payment_minor: 'max_per_request_ulxc',
  hourly_limit_minor: 'hourly_limit_ulxc',
  daily_limit_minor: 'daily_limit_ulxc',
  weekly_limit_minor: 'weekly_limit_ulxc',
  monthly_limit_minor: 'monthly_limit_ulxc',
  approval_above_minor: 'approval_above_ulxc',
}

/** The currency the rules are held in: dollars for rules Lens has not given one. */
export const heldIn = (r: Pick<AgentRules, 'currency'>): string => (r.currency && RULES_DECIMALS[r.currency] !== undefined ? r.currency : 'USD')

/** The currency of the agent's own account: USDC for a crypto agent, its fiat currency otherwise; null when Lens does not say. */
export function agentCurrency(a: Pick<Agent, 'wallet_kind' | 'fiat_currency'>): string | null {
  if (a.wallet_kind === 'crypto') return 'USDC'
  return a.fiat_currency && RULES_DECIMALS[a.fiat_currency] !== undefined ? a.fiat_currency : null
}

/** A limit as the rules hold it, in their own currency's minor units: from the µLXC form, cents at the peg, when Lens
 * names no currency, as Lens moves them (never below a cent for a limit there is). */
export function heldMinor(r: AgentRules, f: MinorLimit, peg: number): number {
  if (r.currency) return r[f] ?? 0
  const ulxc = r[ULXC_OF[f]] ?? 0
  return ulxc > 0 ? Math.max(Math.floor((ulxc * peg) / 10_000), 1) : 0
}

/** An amount typed in currency → its minor units, exact: `12.50` GBP → 1250, `0.000001` USDC → 1. Empty is 0 (no limit);
 * null for anything that is not an amount, or has more decimals than the currency's minor units. A leading £, € or $
 * and thousands commas are allowed. */
export function parseRuleAmount(text: string, currency: string): number | null {
  const places = RULES_DECIMALS[currency]
  if (places === undefined) return null
  const t = text.trim().replace(/^[£€$]/, '').replace(/,/g, '')
  if (t === '') return 0
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t)
  if (!m || (m[2] ?? '').length > places) return null
  const minor = Number(m[1]) * 10 ** places + Number((m[2] ?? '').padEnd(places, '0') || '0')
  return Number.isSafeInteger(minor) ? minor : null
}

/** Minor units → the text a field shows for them, `12.5`; empty for none. Every minor unit kept, so it reads back exact. */
export function ruleAmountText(minor: number, currency: string): string {
  const places = RULES_DECIMALS[currency] ?? 2
  if (!(minor > 0)) return ''
  const whole = Math.floor(minor / 10 ** places)
  const part = String(minor % 10 ** places).padStart(places, '0').replace(/0+$/, '')
  return part === '' ? String(whole) : `${whole}.${part}`
}

/** What one unit of each currency is worth in euros' terms: units per euro, from the day's rates. */
function perEuro(currency: string, fx: FXRates): number | null {
  if (currency === 'EUR') return 1
  if (currency === 'GBP') return fx.gbp_per_eur
  if (currency === 'USD' || currency === 'USDC') return fx.usd_per_eur
  return null
}

/** Minor units of from in to's minor units, rounded down: dollars and USDC by their decimals with no rate, as Lens does;
 * pounds and euros at the day's rate. Null while a rate it needs is unknown. */
export function convertDown(minor: number, from: string, to: string, fx: FXRates | null): number | null {
  const [df, dt] = [RULES_DECIMALS[from], RULES_DECIMALS[to]]
  if (df === undefined || dt === undefined) return null
  if (minor <= 0) return 0
  const dollars = (c: string) => c === 'USD' || c === 'USDC'
  if (from === to || (dollars(from) && dollars(to))) return dt >= df ? minor * 10 ** (dt - df) : Math.floor(minor / 10 ** (df - dt))
  if (!fx) return null
  const [pf, pt] = [perEuro(from, fx), perEuro(to, fx)]
  if (!pf || !pt || !(pf > 0) || !(pt > 0)) return null
  // A hair over the float's own error, so 1250 × an exact rate never lands one below its whole.
  return Math.floor((minor / 10 ** df) * (pt / pf) * 10 ** dt + 1e-9)
}

/** The rules as a save names them: every rule as read, in currency with each limit in its minor units (limits; the
 * held ones when none are given), and no µLXC limit. */
export function rulesSave(r: AgentRules, peg: number, currency = heldIn(r), limits?: Record<MinorLimit, number>): AgentRulesSave {
  const out: AgentRules = { ...r }
  for (const f of Object.values(ULXC_OF)) delete (out as Partial<AgentRules>)[f]
  const minor = (f: MinorLimit) => limits?.[f] ?? heldMinor(r, f, peg)
  return {
    ...out,
    currency,
    max_per_payment_minor: minor('max_per_payment_minor'),
    hourly_limit_minor: minor('hourly_limit_minor'),
    daily_limit_minor: minor('daily_limit_minor'),
    weekly_limit_minor: minor('weekly_limit_minor'),
    monthly_limit_minor: minor('monthly_limit_minor'),
    approval_above_minor: minor('approval_above_minor'),
  }
}

/** Each capability's label, by key, from the workspace's capabilities; one without a label is left out. */
export function workspaceLabels(caps: WalletCapability[] | null): Record<string, string> {
  return Object.fromEntries((caps ?? []).flatMap((c) => (c.label ? [[c.capability, c.label]] : [])))
}

/** Live only when Lens says live for every key; Sandbox when each is live or sandbox and one is sandbox; null while the
 * labels are unread, or when a key has no label or an answer that is neither, because a label not backed is worse than none. */
export function labelOf(labels: Record<string, string> | undefined, keys: readonly string[]): 'live' | 'sandbox' | null {
  const states = keys.map((k) => labels?.[k])
  if (!states.length || states.some((l) => l !== 'live' && l !== 'sandbox')) return null
  return states.every((l) => l === 'live') ? 'live' : 'sandbox'
}

/** Why a write did not happen, in Lens's words where it gave some. */
export function refusalText(err: unknown): string {
  if (err instanceof BffError && err.status === 401) return 'Nothing changed. Sign in again.'
  if (err instanceof BffError && err.status < 500 && err.sentence) {
    const s = err.sentence.replace(/^economy: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing changed. You can try again.'
}
