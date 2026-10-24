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
  status: 'pending' | 'approved' | 'denied' | 'used'
  created_at: string
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
}

/** Lens economy.Statement: every agent wallet a workspace has over [from, to). */
export interface Statement {
  from: string
  to: string
  accounts: { account: string; opening_ulxc: number; in_ulxc: number; out_ulxc: number; closing_ulxc: number }[] | null
  lines: StatementLine[] | null
}

/** Lens economy.CurrencyAccount: the company's or an agent's account in one currency, in minor units. */
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
  /** set while screening holds the payee for an operator */
  screening?: string
  created_at: string
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
}

/** A device key's signature, where Lens takes an approval's or a mandate's assertion (B40.4). */
export interface DeviceAssertion {
  device_id: string
  challenge: string
  signature: string
}

/** Lens economy.PaymentRequest (B40.3): payments prepared for the owner, each with its decision and the rule that made it. */
export interface PaymentRequest {
  id: string
  /** pending_approval | auto | blocked | approved | cancelled */
  status: string
  summary: string
  client: string
  agent_id?: string
  totals: Record<string, number>
  items: PaymentRequestItem[]
  created_at: string
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
  pay_status?: string
}

/** Lens economy.ApprovalStatement (B40.5): exactly what the approval signs. */
export interface ApprovalStatement {
  request_id: string
  items: { position: number; payee_id: string; currency: string; amount_minor: number; reference: string }[] | null
  totals: Record<string, number>
  expires_at: string
}

/** What the BFF answers a phone's sign-in: a session token for the Authorization header. */
export interface MobileSession {
  token: string
  expires_at: string
}

export class BffError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly sentence: string,
  ) {
    super(`${status} ${path}${sentence ? `: ${sentence}` : ''}`)
  }
}

const e = encodeURIComponent

export function createBffClient(baseUrl: string, token: () => string | null, fetchImpl: typeof fetch = fetch) {
  async function send(method: string, path: string, body: string | FormData | undefined, headers: Record<string, string>): Promise<Response> {
    const t = token()
    if (t) headers.Authorization = `Bearer ${t}`
    const res = await fetchImpl(baseUrl + path, { method, headers, body })
    if (!res.ok) {
      let sentence = ''
      try {
        sentence = ((await res.json()) as { error?: string }).error ?? ''
      } catch {
        // a body that is not JSON carries no sentence
      }
      throw new BffError(res.status, path, sentence)
    }
    return res
  }

  async function call<T>(method: string, path: string, body?: object, extra: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extra }
    if (body) headers['Content-Type'] = 'application/json'
    return (await (await send(method, path, body ? JSON.stringify(body) : undefined, headers)).json()) as T
  }

  return {
    /** Trades the identity provider's ID token, got in the system browser with PKCE, for a BFF session. */
    signIn: (idToken: string) => call<MobileSession>('POST', '/auth/mobile/session', { id_token: idToken }),
    book: () => call<AgentBook>('GET', '/api/agents'),
    approvals: () => call<{ approvals: AgentApproval[] | null }>('GET', '/api/agents/approvals'),
    /** The challenge approving or denying one approval is signed over. */
    approvalChallenge: (id: string) => call<{ challenge: string }>('POST', `/api/agents/approvals/${e(id)}/challenge`),
    // Without an assertion Lens says whether this workspace may decide without one.
    approve: (id: string, assertion?: DeviceAssertion) =>
      call<AgentApproval>('POST', `/api/agents/approvals/${e(id)}/approve`, assertion ? { assertion } : undefined),
    deny: (id: string, assertion?: DeviceAssertion) =>
      call<AgentApproval>('POST', `/api/agents/approvals/${e(id)}/deny`, assertion ? { assertion } : undefined),
    /** Every agent's next request or payment is refused until resume-all; each agent's own pause stays as it was. */
    pauseAll: (reason: string) => call<{ all_paused: boolean }>('POST', '/api/agents/pause-all', { reason }),
    resumeAll: () => call<{ all_paused: boolean }>('POST', '/api/agents/resume-all'),
    rules: (id: string) => call<AgentRules>('GET', `/api/agents/${e(id)}/rules`),
    pause: (id: string, reason: string) => call<Agent>('POST', `/api/agents/${e(id)}/pause`, { reason }),
    resume: (id: string) => call<Agent>('POST', `/api/agents/${e(id)}/resume`),
    /** Moves µLXC from the workspace's unallocated balance to the agent; `key` makes a retry move it once. */
    fund: (id: string, amount_ulxc: number, key: string) =>
      call<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/fund`, { amount_ulxc }, { 'Idempotency-Key': key }),
    /** Every agent wallet's statement for [from, to), YYYY-MM-DD at midnight UTC. */
    statement: (from: string, to: string) =>
      call<Statement>('GET', `/api/agents/statement?${new URLSearchParams({ from, to, format: 'json' })}`),
    moneyAccounts: () => call<{ accounts: CurrencyAccount[] | null }>('GET', '/api/money/accounts'),
    payees: () => call<{ payees: OutsidePayee[] | null }>('GET', '/api/money/payees'),
    /** The payments out, newest first. */
    payments: () => call<{ payments: OutsidePayment[] | null }>('GET', '/api/money/payments'),
    /** Pays a saved payee from one account; `idempotency_key` makes a retry pay once. */
    pay: (body: { account_id: string; payee_id: string; amount_minor: number; currency: string; reference: string; idempotency_key: string }) =>
      call<OutsidePayment>('POST', '/api/money/payments', body),
    /** The single-use challenge a new device key signs and binds its attestation to. */
    deviceChallenge: () => call<{ challenge: string }>('POST', '/api/money/devices/challenge'),
    /** Keeps this phone's key as the person's; every byte string is base64url. */
    registerDevice: (body: { platform: string; name: string; public_key: string; challenge: string; signature: string; attestation: string }) =>
      call<DeviceKey>('POST', '/api/money/devices', body),
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
    paymentRequest: (id: string) => call<PaymentRequest>('GET', `/api/money/payment-requests/${e(id)}`),
    /** The statement approving exactly these items, which the approval signs. */
    requestApproval: (id: string, positions: number[]) =>
      call<{ statement: string; challenge: string }>('POST', `/api/money/payment-requests/${e(id)}/approval`, { positions }),
    /** Keeps the signed approval; Lens then pays each approved item once. */
    approveRequest: (id: string, statement: string, assertion: DeviceAssertion) =>
      call<PaymentRequest>('POST', `/api/money/payment-requests/${e(id)}/approve`, { statement, assertion }),
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

/** 12,500,000 µLXC → `12.5 LXC`: every µLXC shown, no trailing zeros. */
export function formatULXC(micros: number): string {
  return `${(micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 })} LXC`
}

/** `2.5` → 2,500,000 µLXC, in whole numbers only; null for anything that is not a positive amount with at most 6 decimals. */
export function parseLXC(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim())
  if (!m) return null
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'))
  return micros > 0 && Number.isSafeInteger(micros) ? micros : null
}

/** 1250, GBP → `12.50 GBP`. */
export function formatMinor(minor: number, currency: string): string {
  const sign = minor < 0 ? '-' : ''
  const m = Math.abs(minor)
  return `${sign}${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')} ${currency}`
}

/** `12.5` → 1250 minor units; null for anything that is not a positive amount with at most 2 decimals. */
export function parseMinor(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return null
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return minor > 0 && Number.isSafeInteger(minor) ? minor : null
}

/** What the owner can still spend: the workspace's balance less every approval still waiting. */
export function safeToSpend(book: AgentBook, approvals: AgentApproval[]): number {
  const held = approvals.filter((a) => a.status === 'pending').reduce((sum, a) => sum + a.amount_ulxc, 0)
  return Math.max(0, book.workspace_balance_ulxc - held)
}

/** The agent's rules as sentences a person reads; a zero limit or an empty list is no rule and says nothing. */
export function rulesInWords(r: AgentRules): string[] {
  const out: string[] = []
  const limit = (micros: number | undefined, words: (amount: string) => string) => {
    if (micros && micros > 0) out.push(words(formatULXC(micros)))
  }
  limit(r.max_per_request_ulxc, (x) => `Spends at most ${x} on one request.`)
  limit(r.hourly_limit_ulxc, (x) => `Spends at most ${x} an hour.`)
  limit(r.daily_limit_ulxc, (x) => `Spends at most ${x} a day.`)
  limit(r.weekly_limit_ulxc, (x) => `Spends at most ${x} a week.`)
  limit(r.monthly_limit_ulxc, (x) => `Spends at most ${x} a month.`)
  limit(r.approval_above_ulxc, (x) => `Asks you first above ${x}.`)
  if (r.requests_per_minute && r.requests_per_minute > 0) out.push(`No more than ${r.requests_per_minute} requests a minute.`)
  if (r.allowed_models?.length) out.push(`Only these models: ${r.allowed_models.join(', ')}.`)
  if (r.allowed_providers?.length) out.push(`Only these providers: ${r.allowed_providers.join(', ')}.`)
  if (r.allowed_payees?.length) out.push(`Pays only ${r.allowed_payees.length} named payee${r.allowed_payees.length === 1 ? '' : 's'}.`)
  if (r.blocked_payees?.length) out.push(`Never pays ${r.blocked_payees.length} blocked payee${r.blocked_payees.length === 1 ? '' : 's'}.`)
  if (r.active_from && r.active_until) out.push(`Works only from ${r.active_from} to ${r.active_until} (${r.timezone || 'UTC'}).`)
  return out.length ? out : ['No limits: it can spend everything it holds.']
}

/** Why a write did not happen, in Lens's words where it gave some. */
export function refusalText(err: unknown): string {
  if (err instanceof BffError && err.status === 401) return 'Nothing changed — sign in again.'
  if (err instanceof BffError && err.status < 500 && err.sentence) {
    const s = err.sentence.replace(/^economy: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing changed. You can try again.'
}
