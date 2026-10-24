import { parseMinor, type OutsidePayee } from '@talyvor/bff-client'

// B40.16 — what Chat on the phone answers itself, without the model, as the web's Chat does (talyvor-suite
// apps/web/src/areas/chat/PayCommand.tsx and WalletButtons.tsx): pausing or restarting every agent, and "pay the ACME
// invoice", which is only prepared — it is paid once the person approves it with Face ID on the approval card.

export const PAUSE_ALL = /^\s*(?:please\s+)?(?:pause|stop|freeze)\s+(?:all|every(?:one)?)(?:\s+(?:of\s+)?(?:my|the))?(?:\s+agents?)?\s*[.!]?\s*$/i
export const RESUME_ALL = /^\s*(?:please\s+)?(?:resume|restart|unpause|start)\s+(?:all|every)(?:\s+(?:of\s+)?(?:my|the))?(?:\s+agents?)?(?:\s+again)?\s*[.!]?\s*$/i

export interface Amount {
  minor: number
  /** Said with the amount ("£120", "120 euros"); otherwise the payee's account decides. */
  currency?: string
}

export interface PayAsk {
  payee: string
  amount?: Amount
  reference: string
}

const PAY = /^\s*(?:please\s+)?pay\s+(.+?)\s*[.!]?\s*$/i
const AMOUNT = /([£€$])\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(pounds?|quid|euros?|dollars?|gbp|eur|usd)\b/i
const SYMBOLS: Record<string, string> = { '£': 'GBP', '€': 'EUR', $: 'USD' }

function amountIn(text: string): { amount: Amount; rest: string } | null {
  const m = AMOUNT.exec(text)
  if (m === null) return null
  const minor = parseMinor((m[2] ?? m[3]).replace(/,/g, ''))
  if (minor === null) return null
  const word = (m[4] ?? '').toLowerCase()
  const currency = m[1] ? SYMBOLS[m[1]] : /^(?:pound|quid|gbp)/.test(word) ? 'GBP' : /^(?:euro|eur)/.test(word) ? 'EUR' : 'USD'
  return { amount: { minor, currency }, rest: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() }
}

/** "£120", "it’s 120 pounds": an answer to "how much?" that is only an amount. */
export function bareAmount(text: string): Amount | null {
  const found = amountIn(text)
  if (found === null) {
    const minor = parseMinor(text.replace(/[,.!\s]+$/, ''))
    return minor === null ? null : { minor }
  }
  return /^(?:it[’']?s|that[’']?s|about)?[\s.!]*$/i.test(found.rest) ? found.amount : null
}

/** What a pay command asks: "pay the ACME invoice", "pay ACME £120", "pay £120 to ACME for the March invoice". A "pay"
 *  that names neither an invoice nor an amount ("pay attention to …") is a question for the model. */
export function parsePay(text: string): PayAsk | null {
  const m = PAY.exec(text)
  if (m === null) return null
  const found = amountIn(m[1])
  const rest = found?.rest ?? m[1]
  const invoice = /\b(invoice|bill)\b/i.exec(rest)
  if (invoice === null && found === null) return null
  const payee = rest
    .split(/\s+for\s+|\s*[—–-]\s+|\s+(?:invoice|bill)s?\b/i)[0]
    .replace(/^(?:to\s+)?(?:the\s+)?/i, '')
    .replace(/[’']s$/i, '')
    .replace(/[\s,.!]+$/, '')
    .trim()
  if (payee === '') return null
  return { payee, amount: found?.amount, reference: invoice !== null ? `${payee} ${invoice[1].toLowerCase()}` : '' }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The saved payees a spoken name means: exactly that name, else the names it starts (“ACME” is “ACME Ltd”). */
export function payeesCalled(payees: OutsidePayee[], said: string): OutsidePayee[] {
  const n = norm(said)
  if (n === '') return []
  const exact = payees.filter((p) => norm(p.name) === n)
  return exact.length > 0 ? exact : payees.filter((p) => norm(p.name).startsWith(n))
}

/** A payee's own currency: a US routing number pays dollars, an IBAN outside the UK euros, anything else pounds. */
export const currencyOf = (p: OutsidePayee) => (p.routing_number ? 'USD' : p.iban && !/^GB/i.test(p.iban) ? 'EUR' : 'GBP')

/** Lens's limit on one spoken answer (talyvor-lens internal/proxy/speech.go maxSpeechChars). */
const SPEECH_LIMIT = 4096

/** An answer as it is read aloud: the words, without the markdown, code said to be on screen, within Lens's limit. */
export function spoken(markdown: string): string {
  const words = markdown
    .replace(/```[\s\S]*?```/g, ' There is code on screen. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (words.length <= SPEECH_LIMIT) return words
  const cut = words.slice(0, SPEECH_LIMIT - 40)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return `${end > 0 ? cut.slice(0, end + 1) : cut} The rest is on screen.`
}
