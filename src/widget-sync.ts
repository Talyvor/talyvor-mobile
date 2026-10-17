import { formatULXC, safeToSpend, type AgentApproval, type AgentBook, type BffClient } from '@talyvor/bff-client'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

import { palettes } from './theme'
import { pushWidget } from './widget-push'
import type { AgentsWidgetProps } from './widgets/agents-widget'

const PINS = 'talyvor.widget.pins'
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

/** Pinned agents first, in the order they were pinned; with none pinned, every agent. */
export function widgetProps(book: AgentBook, approvals: AgentApproval[], pins: string[], token: string): AgentsWidgetProps {
  const live = (book.agents ?? []).filter((a) => !a.archived_at)
  const shown = pins.length ? pins.flatMap((id) => live.filter((a) => a.id === id)) : live
  return {
    signedIn: true,
    safeToSpend: formatULXC(safeToSpend(book, approvals)),
    pending: approvals.filter((a) => a.status === 'pending').length,
    agents: shown.map((a) => ({
      id: a.id,
      name: a.name,
      balance: formatULXC(a.balance_ulxc),
      paused: !!a.paused_at,
      pauseUrl: `talyvor://widget?${new URLSearchParams({ do: 'pause', agent: a.id, t: token })}`,
      openUrl: `talyvor://agents/${encodeURIComponent(a.id)}`,
    })),
    palette: palettes,
  }
}

/** Puts the book and approvals on the home-screen widget, read again unless given; a failure keeps its last picture. */
export async function syncWidget(client: BffClient, loaded?: { book: AgentBook; approvals: AgentApproval[] }) {
  try {
    const [book, approvals, pins, token] = await Promise.all([
      loaded?.book ?? client.book(),
      loaded?.approvals ?? client.approvals().then((r) => r.approvals ?? []),
      pinnedAgents(),
      linkToken(),
    ])
    pushWidget(widgetProps(book, approvals, pins, token))
  } catch {
    // the next screen load or action tries again
  }
}

/** Signed out, the widget shows no figures, and the next account starts with no pins and a new link token. */
export async function clearWidget() {
  pushWidget({ signedIn: false, safeToSpend: '', pending: 0, agents: [], palette: palettes })
  await Promise.all([SecureStore.deleteItemAsync(PINS), SecureStore.deleteItemAsync(TOKEN)])
}
