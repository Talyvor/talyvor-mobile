import type { BffClient } from '@talyvor/bff-client'
import { useEffect, useState } from 'react'

// B59.3 — the areas this workspace has (Lens B59.1, through the BFF). Everything outside the launch pack is an area, off
// for every workspace until the operator switches it on for one, and the phone draws no tab, screen or link for an area
// the workspace does not have. A read that fails leaves the workspace with none.

export type Area = 'chat'

/** null until this session's read has answered or failed, so a link into an area the workspace has is not sent Home
 * while the read is still on its way. */
export function useAreas(client: BffClient): ReadonlySet<string> | null {
  // Kept with the session that read it, so a new sign-in waits for its own read.
  const [read, setRead] = useState<{ client: BffClient; areas: ReadonlySet<string> } | null>(null)
  useEffect(() => {
    let live = true
    client.areas().then(
      (on) => live && setRead({ client, areas: new Set(on) }),
      () => live && setRead({ client, areas: new Set() }),
    )
    return () => {
      live = false
    }
  }, [client])
  return read?.client === client ? read.areas : null
}
