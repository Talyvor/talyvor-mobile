import type { ControlRole } from '@talyvor/bff-client'

// company-words.ts — B59.32: the company details' words, copied word for word from the web's (talyvor-suite B59.31,
// apps/web/src/areas/lens/companyDetailsApi.ts and PageLinks.tsx at cd14b62; `company` from B57.145 at bbde88c), so the phone and the web say the same
// thing. A change to one is a change to both: src/__tests__/company-details.test.tsx holds the web's strings and checks
// the phone's screen against them.

export const COMPANY_WORDS = {
  title: 'Company details',
  line: 'These go to our partner’s identity check later. No identity documents are asked for.',
  company: 'The company',
  people: 'People with control',
  peopleLine: 'Each director, and anyone who owns or controls part of the company.',
  name: 'Name',
  role: 'Role',
  share: 'Share',
  add: 'Add a person',
  remove: 'Remove',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'We couldn’t save that. Nothing changed.',
  readFailed: 'We couldn’t read the company details.',
  personName: 'Add their name.',
  shareRange: 'A share is from 0 to 100%.',
  sharesTotal: 'The shares come to more than 100%.',
} as const

/** Settings' row, as the web's Settings lists it. */
export const COMPANY_ROW = { title: 'Company details', line: 'Company name, number and country, and the people with control' } as const

export const ROLE_LABEL: Record<ControlRole, string> = { director: 'Director', shareholder: 'Shareholder', other: 'Other' }

/** A share as the screen shows it: 2500 is "25". */
export const shareText = (bps: number) => String(bps / 100)

/** A typed share in percent as hundredths of a percent, or null when it is not a number from 0 to 100. */
export function shareBps(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const bps = Math.round(Number(t) * 100)
  return bps <= 10000 ? bps : null
}
