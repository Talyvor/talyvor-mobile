import type { HelpBy } from '@talyvor/bff-client'
import type { Href } from 'expo-router'
import { Linking } from 'react-native'

// help-words.ts — B61.39: the Help chat's words, copied word for word from the web's (talyvor-suite B61.38,
// apps/web/src/components/HelpChat.tsx and areas/lens/helpChat.ts at 0c98444), so the phone and the web say the same
// thing. The suggested questions are Pocket Live's phone `help` (design/pocket-live/index.html).

/** Talyvor's published contact, as the web's apps/web/src/company.ts COMPANY_CONTACT. */
export const COMPANY_CONTACT = 'hello@talyvor.com'

export const HELP_WORDS = {
  title: 'Help',
  lead: 'Ask us anything about Talyvor.',
  ai: 'Answers are written by AI.',
  question: 'Your question',
  placeholder: 'Ask a question',
  ask: 'Ask',
  writeFirst: 'Write your question first.',
  writing: 'Writing an answer…',
  unread: 'The chat could not be read. You can still ask.',
  failed: 'Help could not answer just now. You can try again.',
  byEmail: 'We answer by email.',
  team: 'Send to our team',
  sending: 'Sending…',
  notSent: 'Nothing was sent. You can try again.',
  sent: 'Sent to our team. We answer by email.',
  again: 'Open the email again',
  complaint: 'Make a complaint',
} as const

/** The questions offered before the first one is asked. */
export const HELP_SUGGESTED = ['How do approvals work?', 'How do I pause an agent?', 'How do I add money?'] as const

/** The words each author is shown under. */
export const HELP_BY: Record<HelpBy, string> = { you: 'You', ai: 'Talyvor AI', team: 'Talyvor team' }

/** Settings' row, as Pocket Live's Settings draws it. */
export const HELP_ROW = { title: 'Help', line: 'Ask anything, any time' } as const

/** The /settings/help card that opens the chat, as the web's AskCard. */
export const ASK_CARD = { title: 'Ask us anything about Talyvor.', line: 'Answers are written by AI. Our team is one press away.', open: 'Open Help' } as const

/** A page a reply names (the web's path) and the phone's screen for it. A page the phone has no screen for gets no link. */
export const HELP_PAGES: Record<string, { to: Href; name: string }> = {
  '/agents': { to: '/agents', name: 'Agents' },
  '/approvals': { to: '/approvals', name: 'Approvals' },
  '/settings/help': { to: '/settings/help', name: 'Help and complaints' },
  '/settings/close': { to: '/settings/close', name: 'Close this account' },
  '/settings/data': { to: '/settings/data', name: 'Your data' },
}

/** The person's own email, to Talyvor, with their question filled in. */
export const helpMailto = (question: string) =>
  `mailto:${COMPANY_CONTACT}?subject=${encodeURIComponent('Help with Talyvor')}&body=${encodeURIComponent(question)}`

/** Opens the phone's mail app to Talyvor with the question. The one place the app opens a URL: always a mailto to
 * COMPANY_CONTACT, never an address it was given (src/__tests__/security.test.tsx holds it to that). */
export const openHelpMail = (question: string) => Linking.openURL(helpMailto(question)).catch(() => undefined)
