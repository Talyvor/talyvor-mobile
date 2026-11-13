import type { BffClient, CurrencyAccount, WorkspaceAccount } from '@talyvor/bff-client'
import { useEffect, useState } from 'react'

// B59.11 — a workspace is Business or Personal, and Fiat only, Stablecoin and crypto only, or Hybrid (Lens B59.6), and
// each screen renders only what its type and kind have: SPEC 3.3 and 3.4, the launch pack's two tables. The rules and
// the words are the web's (talyvor-suite B59.10, apps/web/src/areas/lens/agentBankApi.ts at e24f282); a change to one is
// a change to both, and src/__tests__/kind-and-type.test.tsx holds the web's strings. Hidden means not rendered, never
// greyed out. Lens refuses a money route of the wrong kind on its own (B59.7); this is what the screens draw.

export type AccountType = WorkspaceAccount['account_type']
export type MoneyKind = WorkspaceAccount['money_kind']
export type Account = Pick<WorkspaceAccount, 'account_type' | 'money_kind'>

/** What a workspace's type and kind show. */
export interface Shows {
  /** Bank transfers in and out: payees by their bank details. Not for Stablecoin. */
  bankTransfers: boolean
  /** Wallet addresses, on-chain send and receive. Not for Fiat. */
  onChain: boolean
  /** Convert between the two sides. Hybrid only. */
  convert: boolean
  /** Instant transfer. Hybrid only. */
  instantTransfer: boolean
  /** Team, roles and a second approver. Business only. */
  team: boolean
  /** Payout batches. Business only. */
  payoutBatches: boolean
  /** The owner's card tiers, lowest first. */
  cardTiers: readonly string[]
  /** The agents' heading: "Your agents", or "Your team’s agents". */
  agents: string
  /** The owner's own account, where a payment names it: "Your account", or "The company". */
  owner: string
}

export function shows({ account_type, money_kind }: Account): Shows {
  const business = account_type === 'business'
  return {
    bankTransfers: money_kind !== 'stablecoin',
    onChain: money_kind !== 'fiat',
    convert: money_kind === 'hybrid',
    instantTransfer: money_kind === 'hybrid',
    team: business,
    payoutBatches: business,
    cardTiers: business ? ['Team', 'Business', 'Enterprise'] : ['Daily', 'Premium', 'Platinum'],
    agents: business ? 'Your team’s agents' : 'Your agents',
    owner: business ? 'The company' : 'Your account',
  }
}

export const TYPE_LABEL: Record<AccountType, string> = { business: 'Business', personal: 'Personal' }
export const KIND_LABEL: Record<MoneyKind, string> = { fiat: 'Fiat only', stablecoin: 'Stablecoin and crypto only', hybrid: 'Hybrid' }
export const KIND_LINE: Record<MoneyKind, string> = {
  fiat: 'Your agents pay ordinary bills with cards and bank transfers.',
  stablecoin: 'Your agents work on chain.',
  hybrid: 'Both side by side, under one set of rules.',
}
const KIND_CHIP: Record<MoneyKind, string> = { fiat: 'Fiat', stablecoin: 'Stablecoin', hybrid: 'Hybrid' }

/** The account's chip, as the switcher shows it: "Business · Hybrid". */
export const accountChip = (a: Account) => `${TYPE_LABEL[a.account_type]} · ${KIND_CHIP[a.money_kind]}`

/** Settings' line under the account's type. */
export const TYPE_FIXED = 'The type can’t be changed. You can hold several accounts and switch between them.'

/** Pay, for a Stablecoin and crypto account: it has no bank transfers. */
export const PAY_ON_CHAIN = 'Your agents work on chain: each agent’s wallet address is on Agent Wallets.'

/** B59.11 — the owner's own account by the workspace's type, as the web's Pay names it: "Your account · GBP" for a
 * Personal account, "The company · GBP" for a Business. An account given its own name, such as "Payroll · GBP", keeps it. */
export const accountName = (a: CurrencyAccount, owner: string) =>
  a.purpose === 'company' && (!a.name || a.name.startsWith('The company')) ? `${owner} · ${a.currency}` : a.name || `Agent · ${a.currency}`

/** Every workspace Lens had before B59.6 became Business and Hybrid, so nothing it used disappeared. */
const AS_MIGRATED: Account = { account_type: 'business', money_kind: 'hybrid' }

/**
 * The session's workspace's type and kind, and what they show. While the read is on its way `shows` is null and a
 * screen renders nothing that depends on it. A read that failed draws the screens as every existing workspace was
 * migrated, Business and Hybrid, so a failed read never empties someone's money screens; `account` stays null, so
 * nothing claims to know the type or kind.
 */
export function useAccount(client: BffClient): { account: Account | null; shows: Shows | null } {
  // Kept with the session that read it, so a new sign-in waits for its own read.
  const [read, setRead] = useState<{ client: BffClient; account: Account | null } | null>(null)
  useEffect(() => {
    let live = true
    client.account().then(
      (a) => live && setRead({ client, account: { account_type: a.account_type, money_kind: a.money_kind } }),
      () => live && setRead({ client, account: null }),
    )
    return () => {
      live = false
    }
  }, [client])
  if (read?.client !== client) return { account: null, shows: null }
  return { account: read.account, shows: shows(read.account ?? AS_MIGRATED) }
}
