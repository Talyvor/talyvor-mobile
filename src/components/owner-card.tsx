import type { WorkspaceAccount } from '@talyvor/bff-client'

import { OWNER_SUB, ownerFace } from '../cards'
import { Card } from './card'

/** B57.128 — the owner's or company's own card, in its account's tier art. `holder` is the account's name. */
export function OwnerCard({ account, holder, width }: { account: Pick<WorkspaceAccount, 'account_type' | 'money_kind'>; holder: string; width?: number }) {
  const face = ownerFace(account)
  return <Card face={face} holder={holder} sub={OWNER_SUB[face.id]} width={width} />
}
