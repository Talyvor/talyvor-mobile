// @talyvor/bff-client — the phone app's reads and writes through the BFF's /api/agents routes, the same routes the
// web's agentBankApi.ts calls. Every amount is an integer count of µLXC, never a float.
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
  async function call<T>(method: string, path: string, body?: object, extra: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extra }
    const t = token()
    if (t) headers.Authorization = `Bearer ${t}`
    if (body) headers['Content-Type'] = 'application/json'
    const res = await fetchImpl(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) {
      let sentence = ''
      try {
        sentence = ((await res.json()) as { error?: string }).error ?? ''
      } catch {
        // a body that is not JSON carries no sentence
      }
      throw new BffError(res.status, path, sentence)
    }
    return (await res.json()) as T
  }

  return {
    /** Trades the identity provider's ID token, got in the system browser with PKCE, for a BFF session. */
    signIn: (idToken: string) => call<MobileSession>('POST', '/auth/mobile/session', { id_token: idToken }),
    book: () => call<AgentBook>('GET', '/api/agents'),
    approvals: () => call<{ approvals: AgentApproval[] | null }>('GET', '/api/agents/approvals'),
    // Sent without a passkey assertion: Lens says whether this workspace may decide without one.
    approve: (id: string) => call<AgentApproval>('POST', `/api/agents/approvals/${e(id)}/approve`),
    deny: (id: string) => call<AgentApproval>('POST', `/api/agents/approvals/${e(id)}/deny`),
    rules: (id: string) => call<AgentRules>('GET', `/api/agents/${e(id)}/rules`),
    pause: (id: string, reason: string) => call<Agent>('POST', `/api/agents/${e(id)}/pause`, { reason }),
    resume: (id: string) => call<Agent>('POST', `/api/agents/${e(id)}/resume`),
    /** Moves µLXC from the workspace's unallocated balance to the agent; `key` makes a retry move it once. */
    fund: (id: string, amount_ulxc: number, key: string) =>
      call<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/fund`, { amount_ulxc }, { 'Idempotency-Key': key }),
    /** Every agent wallet's statement for [from, to), YYYY-MM-DD at midnight UTC. */
    statement: (from: string, to: string) =>
      call<Statement>('GET', `/api/agents/statement?${new URLSearchParams({ from, to, format: 'json' })}`),
  }
}

export type BffClient = ReturnType<typeof createBffClient>

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
