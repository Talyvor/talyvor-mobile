import { formatMinor, type AgentApproval, type AgentBook, type BffClient, type CurrencyAccount, type OutsidePayee, type OutsidePayment } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

import { AS_MIGRATED, shows as showsOf, type Shows } from './account'
import { balancesByCurrency } from './balances'
import { palettes } from './theme'
import { pushWidget } from './widget-push'
import type { AgentsWidgetProps } from './widgets/agents-widget'

const PINS = 'talyvor.widget.pins'
const PAYEE_PINS = 'talyvor.widget.payees'
// The widget's Pause link carries this, so a link from anywhere else cannot pause an agent.
const TOKEN = 'talyvor.widget.token'

export async function pinnedAgents(): Promise<string[]> {
  const s = await SecureStore.getItemAsync(PINS)
  return s ? (JSON.parse(s) as string[]) : []
}

export async function setPinned(id: string, pinned: boolean) {
  const pins = (await pinnedAgents()).filter((p) => p !== id)
  await SecureStore.setItemAsync(PINS, JSON.stringify(pinned ? [...pins, id] : pins))
}

export async function pinnedPayees(): Promise<string[]> {
  const s = await SecureStore.getItemAsync(PAYEE_PINS)
  return s ? (JSON.parse(s) as string[]) : []
}

export async function setPayeePinned(id: string, pinned: boolean) {
  const pins = (await pinnedPayees()).filter((p) => p !== id)
  await SecureStore.setItemAsync(PAYEE_PINS, JSON.stringify(pinned ? [...pins, id] : pins))
}

/** The newest payment to this payee, in words: `12.50 GBP on 3 Oct`. */
export function lastPaid(payments: OutsidePayment[], payeeID: string): string {
  const last = payments.filter((p) => p.payee_id === payeeID).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (!last) return 'Not paid yet'
  const on = new Date(last.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${formatMinor(last.amount_minor, last.currency)} on ${on}`
}

async function linkToken(): Promise<string> {
  let t = await SecureStore.getItemAsync(TOKEN)
  if (!t) {
    t = Crypto.randomUUID()
    await SecureStore.setItemAsync(TOKEN, t)
  }
  return t
}

export async function widgetLinkValid(t: string | undefined): Promise<boolean> {
  return !!t && t === (await SecureStore.getItemAsync(TOKEN))
}

/** What a set of accounts holds in each currency, as one line: `$412.50 · 2.00 USDC`. */
const heldWords = (accounts: readonly CurrencyAccount[], shows: Shows) =>
  balancesByCurrency(accounts, shows)
    .map((h) => formatMinor(h.minor, h.currency))
    .join(' · ')

/** Pinned agents first, in the order they were pinned; with none pinned, every agent. Payees show only when pinned.
 * B61.44: the figures are Home's, what the currency accounts hold; an agent's credit is the parked gateway's and is not drawn. */
export function widgetProps(
  book: AgentBook,
  approvals: AgentApproval[],
  pins: string[],
  token: string,
  payees: { pins: string[]; saved: OutsidePayee[]; payments: OutsidePayment[] } = { pins: [], saved: [], payments: [] },
  money: { accounts: readonly CurrencyAccount[]; shows: Shows } = { accounts: [], shows: showsOf(AS_MIGRATED) },
): AgentsWidgetProps {
  const live = (book.agents ?? []).filter((a) => !a.archived_at)
  const shown = pins.length ? pins.flatMap((id) => live.filter((a) => a.id === id)) : live
  return {
    signedIn: true,
    // As Home: with nothing held yet, the total reads $0.00.
    total: heldWords(money.accounts, money.shows) || formatMinor(0, 'USD'),
    totalLabel: money.shows.team ? 'Your company’s total' : 'Your total',
    pending: approvals.filter((a) => a.status === 'pending').length,
    agents: shown.map((a) => ({
      id: a.id,
      name: a.name,
      balance: heldWords(money.accounts.filter((x) => x.agent_id === a.id), money.shows),
      paused: !!a.paused_at,
      pauseUrl: `talyvor://widget?${new URLSearchParams({ do: 'pause', agent: a.id, t: token })}`,
      openUrl: `talyvor://agents/${encodeURIComponent(a.id)}`,
    })),
    // A payee's tap only opens its payment screen: nothing is ever paid from the widget.
    payees: payees.pins.flatMap((id) => payees.saved.filter((p) => p.id === id)).map((p) => ({
      id: p.id,
      name: p.name,
      last: lastPaid(payees.payments, p.id),
      openUrl: `talyvor://payees/${encodeURIComponent(p.id)}`,
    })),
    palette: palettes,
  }
}

/** Puts the book, approvals and accounts on the home-screen widget, read again unless given; a failure keeps its last picture. */
export async function syncWidget(client: BffClient, loaded?: { book: AgentBook; approvals: AgentApproval[]; accounts?: CurrencyAccount[] }) {
  try {
    const payeePins = await pinnedPayees()
    const [book, approvals, pins, token, saved, payments, accounts, account] = await Promise.all([
      loaded?.book ?? client.book(),
      loaded?.approvals ?? client.approvals().then((r) => r.approvals ?? []),
      pinnedAgents(),
      linkToken(),
      payeePins.length ? client.payees().then((r) => r.payees ?? []) : [],
      payeePins.length ? client.payments().then((r) => r.payments ?? []) : [],
      loaded?.accounts ?? client.moneyAccounts().then((r) => r.accounts ?? []),
      // A failed read draws as useAccount does: Business and Hybrid, so no figure is left out.
      client.account().catch(() => null),
    ])
    const shows = showsOf(account ? { account_type: account.account_type, money_kind: account.money_kind } : AS_MIGRATED)
    pushWidget(widgetProps(book, approvals, pins, token, { pins: payeePins, saved, payments }, { accounts, shows }))
  } catch {
    // the next screen load or action tries again
  }
}

/** Signed out, the widget shows no figures, and the next account starts with no pins and a new link token. */
export async function clearWidget() {
  pushWidget({ signedIn: false, total: '', totalLabel: '', pending: 0, agents: [], payees: [], palette: palettes })
  await Promise.all([SecureStore.deleteItemAsync(PINS), SecureStore.deleteItemAsync(PAYEE_PINS), SecureStore.deleteItemAsync(TOKEN)])
}
