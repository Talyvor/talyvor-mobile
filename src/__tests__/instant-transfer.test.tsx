import { BffError } from '@talyvor/bff-client'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native'

import InstantTransferScreen from '../app/instant-transfer'
import InstantTransferProgressScreen from '../app/instant-transfer/[id]'
import * as phone from '../instant-transfer'

// B59.20 — Instant transfer on the phone (design P7 to P10, launch pack 4.1): the quote card's fields and its 30 seconds
// counting down, with a fresh quote when they run out; Continue mockChecks Face ID and sends under one key; a refusal read
// from its field; the owner's approval signed with this phone's key and sent again at a fresh quote under the same key;
// each progress state; the receipt with both conversions and the on-chain reference; and the web's words. A workspace that
// is not Hybrid has no entry at all: kind-and-type.test.tsx holds that for all six kinds and types.

jest.setTimeout(30_000)

/** The web's strings, typed from suite bf9f8d3 (apps/web/src/areas/lens/InstantTransfer.tsx, InstantTransferReceipt.tsx and
 * AgentBank.tsx): the phone is checked against these, not against its own copy. */
const WEB = {
  choices: [
    ['A Talyvor account', 'Lands in their balance.'],
    ['An outside wallet', 'We send the stablecoin to the address they give.'],
    ['An outside bank account', 'They get fiat in their bank account.'],
  ],
  balance: { USD: 'US dollar', GBP: 'pound', EUR: 'euro', USDC: 'USDC' },
  money: { USD: 'US dollars', GBP: 'pounds', EUR: 'euros', USDC: 'USDC' },
  quote: ['You send', 'Rate', 'Fee', 'They get'],
  pickWho: 'Pick who gets it',
  addAmount: 'Add an amount to see your quote.',
  gettingQuote: 'Getting your quote…',
  noQuote: 'We couldn’t get a quote. Nothing was sent.',
  expired: 'This quote expired. Nothing was sent.',
  screened: 'We can’t send to this recipient. Nothing was sent.',
  rule: 'Remy can’t use Instant transfer. Turn it on in Remy’s rules.',
  holds: 'Remy’s US dollar balance holds $6,200.00. Lower the amount or top up.',
  approvesOnly: 'This approves this payment only.',
  declined: 'Declined. Nothing was sent.',
  steps: ['Sent', 'Converted', 'On its way', 'Received'],
  reversed: 'Didn’t go through',
  leave: 'You can leave this screen. We’ll tell you when it lands.',
  receipt: ['You sent', 'Fee', 'They got', 'Conversions', 'On-chain reference', 'Transfer ID', 'Paid from'],
  canUse: 'Can use Instant transfer',
  canUseLine: 'Off by default. When it’s on, Remy can send Instant transfers inside these rules. Anything outside them waits for your yes.',
  payRow: 'Arrives in seconds, any day, any hour',
} as const

const REMY_USD = { id: 'macc_remy', agent_id: 'agt_remy', currency: 'USD', purpose: 'agent' as const, status: 'open', name: 'USD account', balance_minor: 620_000 }
const LUMEN = { id: 'payee_lf', name: 'Lumen Freight GmbH', country: 'DE', needs_confirmation: false, created_at: '2026-11-01T09:00:00Z' }

let quotes = 0
let quoteLife = 30
function quote(n: number) {
  const created = new Date()
  return {
    id: `itq_${n}`, to: 'bank_account' as const, country: 'DE', send_minor: 500_000, send_currency: 'USD', fee_minor: 1_250, rate: '0.92100000',
    receive_minor: 459_348, receive_currency: 'EUR', arrives_in_seconds: true,
    created_at: created.toISOString(), expires_at: new Date(created.getTime() + quoteLife * 1000).toISOString(),
  }
}
const LEGS = [
  { id: 'itr_7Q2M:convert', leg: 'convert' as const, done: true, sell: { minor: 500_000, currency: 'USD' }, buy: { minor: 4_987_500_000, currency: 'USDC' } },
  { id: 'itr_7Q2M:move', leg: 'move' as const, done: true, partner_ref: '0x9f3ac41e', sell: { minor: 4_987_500_000, currency: 'USDC' }, buy: { minor: 4_987_500_000, currency: 'USDC' } },
  { id: 'itr_7Q2M:payout', leg: 'payout' as const, done: true, sell: { minor: 4_987_500_000, currency: 'USDC' }, buy: { minor: 459_348, currency: 'EUR' } },
]
const transfer = (status: 'sent' | 'converted' | 'on_its_way' | 'received' | 'reversed') => ({
  id: 'itr_7Q2M', agent_id: 'agt_remy', from_account_id: 'macc_remy', to_payee_id: 'payee_lf', beneficiary_name: 'Lumen Freight GmbH',
  send_minor: 500_000, send_currency: 'USD', fee_minor: 1_250, receive_minor: 459_348, receive_currency: 'EUR', rate: '0.92100000',
  arrives_in_seconds: true, status, legs: LEGS, created_at: '2026-11-14T10:42:07Z', updated_at: '2026-11-14T10:42:19Z',
})

let sends: { agent: string; body: Record<string, unknown>; key: string }[] = []
let sendAnswers: (() => Promise<unknown>)[] = []
let decided: { id: string; signed: boolean }[] = []
let mockChecks: string[] = []
let status: Parameters<typeof transfer>[0] = 'received'
/** The approval Lens filed for the transfer: Remy's dollar account, $5,000.00. */
const FILED = {
  id: 'apr_1', agent_id: 'agt_remy', amount_ulxc: 0, model: '', status: 'pending' as const, created_at: '2026-11-14T10:42:00Z',
  paid_from: { kind: 'account' as const, account_id: 'macc_remy', name: 'Remy’s US dollar account', currency: 'USD', amount_minor: 500_000, balance_minor: 620_000 },
}
let mockFiled: Record<string, unknown> = FILED
const mockClient = {
  account: async () => ({ workspace_id: 'ws_1', account_type: 'business', money_kind: 'hybrid' }),
  capabilities: async () => ({ capabilities: [] }),
  moneyAccounts: async () => ({ accounts: [REMY_USD] }),
  payees: async () => ({ payees: [LUMEN] }),
  book: async () => ({ agents: [{ id: 'agt_remy', name: 'Remy', description: 'Research', balance_ulxc: 0, spent_ulxc: 0, created_at: '2026-10-01T09:00:00Z' }] }),
  instantQuote: async () => quote(++quotes),
  instantSend: async (agent: string, body: Record<string, unknown>, key: string) => {
    sends.push({ agent, body, key })
    return (sendAnswers.shift() ?? (async () => transfer('received')))()
  },
  approvals: async () => ({ approvals: [mockFiled] }),
  approvalChallenge: async () => ({ challenge: 'Y2g' }),
  approve: async (id: string, assertion?: unknown) => void decided.push({ id, signed: !!assertion }),
  deny: async (id: string) => void decided.push({ id, signed: false }),
  instantTransfer: async () => transfer(status),
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
jest.mock('../keys', () => ({
  biometricName: 'Face ID',
  phoneKey: async () => ({ id: 'dk_1', here: true, owner: '' }),
  checkItsYou: async (reason: string) => (mockChecks.push(reason), 'ok'),
  signWithThisPhone: async (_: unknown, challenge: string) => ({ device_id: 'dk_1', challenge, signature: 'sig' }),
  keyGone: () => false,
  keyGoneText: '',
}))
let mockUUID = 0
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockUUID}` }))
jest.mock('expo-clipboard', () => ({ setStringAsync: async () => true }))
const mockPushed: unknown[] = []
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'itr_7Q2M' }),
  Redirect: () => null,
  router: { push: (to: unknown) => mockPushed.push(to), replace: (to: unknown) => mockPushed.push(to), canGoBack: () => true, back: () => undefined },
}))
jest.mock('../components/ui', () => {
  const { View } = jest.requireActual('react-native')
  return { ...jest.requireActual('../components/ui'), Screen: ({ children }: { children: unknown }) => <View>{children}</View> }
})

beforeEach(() => {
  quotes = 0
  quoteLife = 30
  sends = []
  sendAnswers = []
  decided = []
  mockChecks = []
  status = 'received'
  mockFiled = FILED
  mockPushed.length = 0
})

/** Instant transfer, to Lumen Freight's bank, from Remy's US dollars: $5,000.00. */
async function fillIn() {
  await render(<InstantTransferScreen />)
  await fireEvent.press(await screen.findByRole('radio', { name: 'An outside bank account' }))
  await fireEvent.press(await screen.findByRole('radio', { name: /^Lumen Freight GmbH/ }))
  await fireEvent.changeText(screen.getByLabelText('Amount'), '5000')
  const card = await screen.findByTestId('instant-quote')
  await within(card).findByText('$5,000.00', {}, { timeout: 3000 })
  return card
}
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }))

describe('the quote card', () => {
  test('you send, rate, fee and they get, arrives in seconds, locked for 30 seconds and counting down', async () => {
    const card = await fillIn()
    expect(within(card).getByText('1 USD = 0.9210 EUR')).toBeTruthy()
    expect(within(card).getByText('$12.50')).toBeTruthy()
    expect(within(card).getByText('€4,593.48')).toBeTruthy()
    expect(within(card).getByText('Arrives in seconds')).toBeTruthy()
    expect(within(card).getByText('Locked for 30 seconds')).toBeTruthy()
    expect(within(card).getByTestId('instant-seconds-left').props.children).toBe('30 seconds left')
    await waitFor(() => expect(within(card).getByTestId('instant-seconds-left').props.children).toBe('29 seconds left'), { timeout: 2500 })
    expect(screen.getByText('Face ID asks before anything is sent.')).toBeTruthy()
    expect(quotes).toBe(1)
  })

  test('takes a fresh quote when the seconds run out', async () => {
    quoteLife = 1
    await fillIn()
    await waitFor(() => expect(quotes).toBeGreaterThanOrEqual(2), { timeout: 4000 })
  })
})

describe('sending it', () => {
  test('Continue mockChecks Face ID, sends the quote under one key and opens its progress', async () => {
    await fillIn()
    await press('Continue')
    expect(mockChecks).toEqual(['Send $5,000.00 to Lumen Freight GmbH'])
    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({ agent: 'agt_remy', body: { quote_id: 'itq_1', to_payee_id: 'payee_lf' } })
    expect(sends[0].key).toMatch(/^key-/)
    expect(mockPushed).toEqual([{ pathname: '/instant-transfer/[id]', params: { id: 'itr_7Q2M' } }])
  })

  test('an agent without the rule is told so from the field, with the way to its rules', async () => {
    sendAnswers.push(async () => {
      throw new BffError(403, '/api/agents/agt_remy/instant-transfers', 'this agent’s rules do not let it use Instant transfer', 'agent_rule', 'may_instant_transfer')
    })
    await fillIn()
    await press('Continue')
    const refused = screen.getByTestId('instant-refused')
    expect(within(refused).getByText(WEB.rule)).toBeTruthy()
    expect(within(refused).queryByText(/may_instant_transfer/)).toBeNull()
    await fireEvent.press(within(refused).getByRole('button', { name: 'Open Remy’s rules' }))
    expect(mockPushed).toEqual([{ pathname: '/agents/[id]', params: { id: 'agt_remy' } }])
  })

  test('when Lens asks for the owner’s approval, Approve with Face ID signs it and sends again at a fresh quote under the same key', async () => {
    sendAnswers.push(async () => {
      throw new BffError(403, '/api/agents/agt_remy/instant-transfers', 'this request would cost up to $5,000.00, above the agent’s approval amount. Approval apr_1 must be approved by the workspace’s owner before it is retried')
    })
    await fillIn()
    await press('Continue')
    const sheet = await screen.findByTestId('instant-approval')
    expect(within(sheet).getByText('From Remy’s account')).toBeTruthy()
    expect(within(sheet).getByText('They get €4,593.48 · Arrives in seconds')).toBeTruthy()
    expect(within(sheet).getByText(WEB.approvesOnly)).toBeTruthy()
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Approve with Face ID' }))
    expect(decided).toEqual([{ id: 'apr_1', signed: true }])
    expect(sends).toHaveLength(2)
    expect(sends[1].body.quote_id).not.toBe(sends[0].body.quote_id)
    expect(sends[1].key).toBe(sends[0].key)
    expect(mockPushed).toEqual([{ pathname: '/instant-transfer/[id]', params: { id: 'itr_7Q2M' } }])
  })
})

test('an approval that is not this transfer’s is never signed', async () => {
  mockFiled = { ...FILED, paid_from: { ...FILED.paid_from, amount_minor: 900_000 } }
  sendAnswers.push(async () => {
    throw new BffError(403, '/api/agents/agt_remy/instant-transfers', 'Approval apr_1 must be approved by the workspace’s owner before it is retried')
  })
  await fillIn()
  await press('Continue')
  const sheet = await screen.findByTestId('instant-approval')
  await fireEvent.press(within(sheet).getByRole('button', { name: 'Approve with Face ID' }))
  expect(within(sheet).getByText('Nothing changed. You can try again.')).toBeTruthy()
  expect(decided).toEqual([])
  expect(sends).toHaveLength(1)
})

describe('its progress', () => {
  const cases: [Parameters<typeof transfer>[0], string[], string][] = [
    ['sent', ['done', 'current', 'next', 'next'], 'Sent'],
    ['converted', ['done', 'done', 'current', 'next'], 'Converted'],
    ['on_its_way', ['done', 'done', 'current', 'next'], 'On its way'],
    ['received', ['done', 'done', 'done', 'done'], 'Received'],
    ['reversed', ['failed', 'next', 'next', 'next'], 'Didn’t go through'],
  ]
  for (const [state, steps, eyebrow] of cases)
    test(`${state}: ${eyebrow}`, async () => {
      status = state
      await render(<InstantTransferProgressScreen />)
      const progress = await screen.findByTestId('instant-progress')
      expect(within(progress).getByTestId('instant-status').props.children).toBe(eyebrow)
      expect(within(progress).getAllByTestId(/^instant-step-/).map((s) => s.props.testID.replace('instant-step-', ''))).toEqual(steps)
      if (state === 'reversed') expect(within(progress).getByText('This transfer didn’t go through. The full $5,000.00 is back in Remy’s US dollar balance.')).toBeTruthy()
      else if (state === 'received') expect(within(progress).getByRole('button', { name: 'See the receipt' })).toBeTruthy()
      else expect(within(progress).getByText(WEB.leave)).toBeTruthy()
    })
})

test('the receipt shows both conversions and the on-chain reference', async () => {
  await render(<InstantTransferProgressScreen />)
  await screen.findByTestId('instant-progress')
  await press('See the receipt')
  const receipt = screen.getByTestId('instant-receipt')
  expect(within(receipt).getAllByText('$5,000.00').length).toBeGreaterThan(0)
  expect(within(receipt).getByText('€4,593.48')).toBeTruthy()
  const conversions = within(receipt).getByTestId('instant-conversions')
  expect(within(conversions).getByText('$4,987.50 to 4,987.50 USDC')).toBeTruthy()
  expect(within(conversions).getByText('Rate 1 USD = 1.0000 USDC')).toBeTruthy()
  expect(within(conversions).getByText('4,987.50 USDC to €4,593.48')).toBeTruthy()
  expect(within(conversions).getByText('Rate 1 USDC = 0.9210 EUR')).toBeTruthy()
  expect(within(receipt).getByText('0x9f3ac41e')).toBeTruthy()
  expect(within(receipt).getByRole('button', { name: 'Copy the on-chain reference' })).toBeTruthy()
  expect(within(receipt).getByText('itr_7Q2M')).toBeTruthy()
  expect(within(receipt).getByText('Remy’s US dollar balance')).toBeTruthy()
})

test("the phone's words for Instant transfer are the web's", () => {
  expect(phone.CHOICES.map((c) => [c.title, c.line])).toEqual(WEB.choices)
  expect(phone.BALANCE_WORDS).toEqual(WEB.balance)
  expect(phone.MONEY_WORDS).toEqual(WEB.money)
  expect([phone.WORDS.youSend, phone.WORDS.rate, phone.WORDS.fee, phone.WORDS.theyGet]).toEqual(WEB.quote)
  expect([phone.WORDS.pickWho, phone.WORDS.addAmount, phone.WORDS.gettingQuote, phone.WORDS.noQuote, phone.WORDS.expired, phone.WORDS.screened, phone.WORDS.declined]).toEqual([
    WEB.pickWho, WEB.addAmount, WEB.gettingQuote, WEB.noQuote, WEB.expired, WEB.screened, WEB.declined,
  ])
  expect(phone.WORDS.approvesOnly).toBe(WEB.approvesOnly)
  expect([...phone.STEPS]).toEqual(WEB.steps)
  expect(phone.STATUS_WORDS.reversed).toBe(WEB.reversed)
  expect(phone.WORDS.leave).toBe(WEB.leave)
  expect([phone.WORDS.youSent, phone.WORDS.fee, phone.WORDS.theyGot, phone.WORDS.conversions, phone.WORDS.onChainReference, phone.WORDS.transferId, phone.WORDS.paidFrom]).toEqual(WEB.receipt)
  expect([phone.WORDS.canUse, phone.WORDS.canUseLine('Remy'), phone.WORDS.payRow]).toEqual([WEB.canUse, WEB.canUseLine, WEB.payRow])
  // The refusals are picked from the field and the code, as the web picks them.
  expect(phone.sendRefusal(new BffError(403, '', 'no', 'agent_rule', 'may_instant_transfer'), 'Remy', null)).toBe(WEB.rule)
  expect(phone.sendRefusal(new BffError(403, '', 'no', 'screened', 'to_payee_id'), 'Remy', null)).toBe(WEB.screened)
  expect(phone.sendRefusal(new BffError(409, '', 'the account holds $6,200.00 of test money'), 'Remy', { minor: 620_000, currency: 'USD' })).toBe(WEB.holds)
  expect(phone.rateText('0.92100000', 'USD', 'EUR')).toBe('1 USD = 0.9210 EUR')
  expect(phone.arrivesText({ arrives_in_seconds: true })).toBe('Arrives in seconds')
})
