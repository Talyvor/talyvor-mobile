// signup-words.ts — B59.9: sign-up's words, copied word for word from the web's (talyvor-suite B59.8,
// apps/web/src/areas/auth/signupWords.ts at a8240e4), so the phone and the web say the same thing. A change to one is a
// change to both: src/__tests__/sign-up.test.tsx holds the web's strings and checks the phone's screen against them.

import type { SignupAnswers } from '@talyvor/bff-client'

export type AccountType = SignupAnswers['account_type']
export type MoneyKind = SignupAnswers['money_kind']

export const SIGNUP_STEPS = ['Who is this account for?', 'Pick the kind of money', 'Add a passkey or pair your phone', 'Confirm who you are'] as const

export const ACCOUNT_TYPES: readonly { value: AccountType; title: string; line: string }[] = [
  { value: 'personal', title: 'Personal', line: 'For you and your own agents.' },
  { value: 'business', title: 'Business', line: 'For a company and its team.' },
]

export const MONEY_KINDS: readonly { value: MoneyKind; title: string; line: string; list: (type: AccountType) => string[] }[] = [
  {
    value: 'fiat',
    title: 'Fiat only',
    line: 'Your agents pay ordinary bills with cards and bank transfers.',
    list: (type) => ['Balances in GBP, EUR and USD', type === 'personal' ? 'Cards with Personal art' : 'Cards with Corporate art', 'Bank transfers in and out'],
  },
  {
    value: 'stablecoin',
    title: 'Stablecoin and crypto only',
    line: 'Your agents work on chain.',
    list: () => ['Stablecoin and crypto balances', 'A card that spends from the stablecoin balance', 'Wallet addresses, on-chain send and receive'],
  },
  {
    value: 'hybrid',
    title: 'Hybrid',
    line: 'Both side by side, under one set of rules.',
    list: () => ['Both balances, one total with the split', 'All cards', 'Convert between the two sides', 'Instant transfer'],
  },
]

/** The profile each type asks for. No identity document is asked for. */
export const PROFILE_LABELS = {
  name: 'Your name',
  companyName: 'Company name',
  registrationNumber: 'Registration number',
  country: 'Country',
} as const

export const PROFILE_ERRORS = {
  name: 'Add your name.',
  companyName: 'Add the company name.',
  registrationNumber: 'Add the registration number.',
  country: 'Pick your country.',
} as const

// B61.5, as the web's B61.4 — Nick, 15 Nov: the type and the kind are fixed once the account is open; another of either
// is another account. Settings, Account says the same two sentences.
export const TYPE_NOTE = 'The type can’t be changed later. To use another type, open another account.'
export const KIND_NOTE = 'The kind of money can’t be changed later. To use another kind, open another account.'

/** The line under step 2's title: "For Northwind Studio, a Business account." */
export function kindFor(name: string, type: AccountType): string {
  return `For ${name}, a ${type === 'personal' ? 'Personal' : 'Business'} account.`
}

/** The countries sign-up offers: the same list the marketplace's seller tax form offers. */
export const COUNTRIES: readonly (readonly [string, string])[] = [
  ['AU', 'Australia'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BR', 'Brazil'], ['BG', 'Bulgaria'], ['CA', 'Canada'],
  ['HR', 'Croatia'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'],
  ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['HU', 'Hungary'], ['IS', 'Iceland'], ['IN', 'India'],
  ['IE', 'Ireland'], ['IL', 'Israel'], ['IT', 'Italy'], ['JP', 'Japan'], ['LV', 'Latvia'], ['LI', 'Liechtenstein'],
  ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MT', 'Malta'], ['MX', 'Mexico'], ['NL', 'Netherlands'],
  ['NZ', 'New Zealand'], ['NO', 'Norway'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SG', 'Singapore'],
  ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['ZA', 'South Africa'], ['ES', 'Spain'], ['SE', 'Sweden'],
  ['CH', 'Switzerland'], ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'], ['US', 'United States'],
]

/** B61.111 — Lens's code for a country Talyvor does not serve (talyvor-lens B61.53). Its sentence is Lens's own. */
export const COUNTRY_NOT_SERVED = 'country_not_served'

/** B61.111 — the countries a picker offers: exactly the codes Lens serves, each by the app's own name, or by its code
 * where the app has none, in name order. Until Lens has said, the app's own list; Lens still refuses one it does not serve. */
export function servedCountries(served: readonly string[] | undefined): readonly (readonly [string, string])[] {
  if (!served) return COUNTRIES
  const names = new Map(COUNTRIES)
  return served.map((code) => [code, names.get(code) ?? code] as const).sort((a, b) => a[1].localeCompare(b[1], 'en'))
}

// B61.21 — step 4, "Confirm who you are", word for word from the web's B61.20 (talyvor-suite PR #1120 at 99205a0,
// apps/web/src/areas/auth/signupWords.ts): the identity check, run against Lens's levels. Settings, Verification shows the
// same parts with the same words. B57.174: what Pocket Live draws (design/pocket-live texts.json 'ph su5', 15 Nov) takes
// its words: the line, Full name and the Sandbox note in place of the ID document's card.
export const IDENTITY_WORDS = {
  line: 'The law asks us to check. It takes a minute.',
  checks: 'The checks',
  contact: 'Email and phone',
  person: 'Who you are',
  company: 'Your company',
  email: 'Email',
  phone: 'Phone number',
  phoneHint: 'With the country code, like +447700900123.',
  legalName: 'Full name',
  dateOfBirth: 'Date of birth',
  // Not su5's "Country": a Business's company details on the same screen have a Country of their own.
  country: 'Country you live in',
  run: 'Confirm who I am',
  running: 'Checking…',
  passed: 'Passed',
  passedSandbox: 'Passed in Sandbox',
  checking: 'Checking…',
  waiting: 'Waiting for the checker',
  notPassed: 'Not passed',
  notYet: 'Not checked yet',
  sandboxNote: 'In Sandbox we check these details only. No document or photo is uploaded.',
  done: 'You’re confirmed. Your account is open.',
  open: 'Open the app',
  // B61.118 — the way into the app while a check waits, or after one did not pass; never says the check passed.
  openWaiting: 'You can look around now. Once your identity check passes, you can move money.',
  openNotPassed: 'You can try the check again from Settings, Verification.',
  gate: 'Your account can look around but can’t move money until you confirm who you are.',
  finish: 'Finish confirming who you are',
} as const

export const IDENTITY_ERRORS = {
  email: 'Add your email address.',
  phone: 'Add your phone number with its country code, like +447700900123.',
  legalName: 'Add your full name.',
  dateOfBirth: 'Add your date of birth.',
  country: 'Pick the country you live in.',
  companyFirst: 'Save the company details, with at least one director, first.',
  named: (name: string) => `Add ${name} to the people with control, and save.`,
  failed: {
    contact: 'We couldn’t confirm your email and phone. Check them and try again.',
    person: 'We couldn’t confirm who you are. Check your full name, date of birth and country, and try again.',
    company: 'We couldn’t confirm your company. Check the company details and the people with control, and try again.',
  },
  expired: 'Your identity check expired. Start it again.',
  unknown: 'Nothing was checked. You can try again.',
} as const
