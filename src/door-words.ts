import { BffError } from '@talyvor/bff-client'

// B61.27 — the door and the lock on the phone, in Pocket Live's words (design/pocket-live texts.json: `ph su0` to
// `ph su2`, `ph su6`, `ph lock`). Lines Pocket Live does not draw are listed under "Words to confirm" on the PR.

export const DOOR_WORDS = {
  phone: { title: 'What’s your phone number?', line: 'We text you a code to check it’s yours.', code: 'Country code', number: 'Phone number', go: 'Continue' },
  code: {
    title: 'Enter the code',
    sentTo: (phone: string) => `We sent it to ${phone}.`,
    sandbox: (code: string) => `In Sandbox no text is sent. Your code is ${code.replace(/^(\d{3})(\d{3})$/, '$1 $2')}.`,
    field: 'Code',
  },
  choose: { title: 'Choose a passcode', line: '6 digits. You type it each time you open Talyvor on this phone.' },
  again: { title: 'Type it again', line: 'The same 6 digits, to be sure.', differ: 'Those passcodes don’t match. Choose one again.' },
  enter: { title: 'Enter your passcode' },
  faceID: {
    title: 'Approve with Face ID',
    line: 'This phone gets a key that never leaves it. You say yes to payments with a look.',
    on: 'Turn on Face ID',
    later: 'Not now',
  },
  lock: { title: 'Enter your passcode', faceID: 'Use Face ID', forgot: 'Forgot your passcode?', signup: 'New here? Open an account' },
  forgot: {
    title: 'Forgot your passcode?',
    line: 'Our help team can set you up with a new one once they have checked it’s you. Write to us from the email on your account.',
    write: 'Write to us',
    mail: 'I forgot my Talyvor passcode and need help to get back in.',
    back: 'Back to the passcode',
    // B61.109 — with Face ID on: the number's code, then Face ID, then a new passcode.
    faceID: 'Check it’s you with Face ID, then choose a new passcode.',
    choose: 'Choose a new passcode',
  },
  change: {
    title: 'Change passcode',
    line: '6 digits, asked each time you open Talyvor',
    old: 'Enter your passcode',
    done: 'Your passcode is changed.',
  },
  failed: 'That did not work just now. Try again.',
} as const

/** The time a wait ends, as the phone's clock reads it. */
const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** What the person is told when the door or the lock refuses: Lens's own sentence, worded for them, for a refusal; the
 * wait after too many wrong passcodes with the time it ends; ours for anything else. */
export function doorRefusal(err: unknown): string {
  if (!(err instanceof BffError) || err.status >= 500 || !err.sentence) return DOOR_WORDS.failed
  if (err.code === 'passcode_wait' && err.retryAt) return `Too many wrong passcodes. Try again at ${clock(err.retryAt)}.`
  return err.sentence
}

/** How long the wait after too many wrong passcodes still runs, in milliseconds; 0 when there is none. */
export const waitLeft = (err: unknown) => (err instanceof BffError && err.code === 'passcode_wait' && err.retryAt ? Math.max(0, Date.parse(err.retryAt) - Date.now()) : 0)
