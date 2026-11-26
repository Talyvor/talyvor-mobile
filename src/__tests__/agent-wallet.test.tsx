import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

import { walletHref } from '../push'

// B48.20 — an agent's wallet on the phone, against a stubbed BFF: its balances and how to pay into it with the address's
// QR code; Top up and Cash out, quoted then confirmed once, the cash-out signed by this phone's key over Lens's challenge
// for exactly that move; Send, which asks Face ID through the key before it goes, under one Idempotency-Key; Request as
// a link and QR code; Activity with its explorer link; Limits and Freeze signed by this phone's key when it owns the
// agent's account; and a push about the wallet opening the part it is about. B48.51: a send to a name.eth or a saved name
// shows the address it resolved to, and the owner's send and their yes are signed by this phone's key over Lens's
// challenges (Lens B48.49). The words are the web's (talyvor-suite
// 0914fa6, AgentMoneyWallet.tsx, AgentWalletActions.tsx, AgentCryptoSend.tsx and AgentWalletLimits.tsx).

jest.setTimeout(30_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('expo-clipboard', () => ({ setStringAsync: async () => true }))
let mockUUID = 0
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_: string, b: Uint8Array) => Uint8Array.from(jest.requireActual('node:crypto').createHash('sha256').update(b).digest()).buffer,
  randomUUID: () => `key-${++mockUUID}`,
}))
/** Lens's economy.MandateChallenge: the canonical JSON's SHA-256, base64url. */
const challengeOf = (canonical: string) => jest.requireActual('node:crypto').createHash('sha256').update(canonical).digest('base64url')
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test' } }))
/** What the phone's key signed, and the reason Face ID showed, in order. */
const mockSigned: { message: string; reason: string }[] = []
let mockCancel = false
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_alias: string, message: string, reason: string) => {
    if (mockCancel) throw Object.assign(new Error('cancelled'), { code: 'ERR_BIOMETRIC' })
    mockSigned.push({ message, reason })
    return 'sig'
  },
  deleteKey: async () => undefined,
}))

const ADDRESS = '0x1111111111111111111111111111111111111111'
const TO = '0x2222222222222222222222222222222222222222'
const TX = `0x${'ab'.repeat(32)}`
const USDC_ON_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const WALLETS = {
  agent_id: 'agt_remy',
  wallet_kind: 'crypto',
  wallets: [{ account_id: 'acc_u', agent_id: 'agt_remy', asset: 'USDC', partner: 'circle', balance_minor: 125_500_000, mode: 'LIVE', receive: { asset: 'USDC', network: 'base', address: ADDRESS } }],
}
const QUOTE = { network: 'base', token: 'USDC', amount_minor: 2_500_000, to: TO, to_kind: 'address', new_address: true, max_fee_wei: '42000000000000', fee_paid_by: 'workspace_gas_budget', arrival_seconds: 12 }
const MOVE = (route: string, status = 'quoted') => ({
  id: `wm_${route}`, agent_id: 'agt_remy', route, sell_minor: route === 'cash_out' ? 10_000_000 : 1_000, sell_currency: route === 'cash_out' ? 'USDC' : 'GBP',
  fee_minor: route === 'cash_out' ? 50_000 : 10, buy_minor: route === 'cash_out' ? 780 : 12_600_000, buy_currency: route === 'cash_out' ? 'GBP' : 'USDC', rate: '1.2700', status,
})
const PERMISSION = { number: 3, permission: { tokens: [{ token: USDC_ON_BASE, allowance: 50_000_000, period: 'week', per_payment: 10_000_000 }], allowed: [], blocked: [], expires: '2027-06-30T23:59:59Z' }, signed_at: '2026-11-20T09:00:00Z' }

type Call = { method: string; path: string; body?: Record<string, unknown>; key?: string }

const SAVED = { id: 'caddr_1', name: 'Treasury', address: TO, saved_by: 'user:u1', created_at: '2026-11-20T09:00:00Z', updated_at: '2026-11-20T09:00:00Z' }

function mockBff({
  owner = { role: 'person', device_id: 'dev_1' } as Record<string, string>,
  sends = [] as unknown[],
  lensChanges = {} as Record<string, unknown>,
  quote = QUOTE as Record<string, unknown>,
  challengeTo = '',
  passkeys = [] as string[],
} = {}) {
  const calls: Call[] = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://bff.test', '').split('?')[0]
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, path, body, key: (init.headers as Record<string, string> | undefined)?.['Idempotency-Key'] })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    switch (`${method} ${path}`) {
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/name':
        return json({ id: 'ws_1', name: 'Northwind Studio' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'business', money_kind: 'hybrid' })
      case 'GET /api/wallets/capabilities':
        return json({ capabilities: ['currency_accounts', 'account_details'].map((capability) => ({ capability, name: capability, class: 'AMBER', real_money: false, label: 'sandbox' })) })
      case 'GET /api/agents':
        return json({ agents: [{ id: 'agt_remy', name: 'Remy', balance_ulxc: 0, spent_ulxc: 0, wallet_kind: 'crypto', created_at: '2026-10-01T09:00:00Z' }] })
      case 'GET /api/agents/agt_remy/wallets':
        return json(WALLETS)
      case 'GET /api/agents/agt_remy/smart-account':
        return json({ address: ADDRESS, owners: [owner, { role: 'agent' }] })
      case 'POST /api/agents/agt_remy/crypto-sends/quote':
        return json(quote)
      case 'POST /api/agents/agt_remy/crypto-sends/challenge':
        return json({ challenge: 'ch_send', allow_credentials: passkeys, user_verification: 'required', quote: { ...quote, to: challengeTo || quote.to } })
      case 'POST /api/agents/agt_remy/crypto-sends':
        return json({ ...quote, id: 'cs_1', agent_id: 'agt_remy', direction: 'out', status: 'sending', created_at: '2026-11-25T09:00:00Z' })
      case 'POST /api/agents/agt_remy/crypto-sends/cs_9/approve/challenge':
        return json({ challenge: body.test_amount_minor ? 'ch_test' : 'ch_yes', allow_credentials: passkeys, user_verification: 'required' })
      case 'GET /api/crypto-addresses':
        return json({ addresses: [SAVED] })
      case 'POST /api/crypto-addresses':
        return json({ ...SAVED, id: 'caddr_2', name: body.name, address: body.address })
      case 'DELETE /api/crypto-addresses/caddr_1':
        return new Response(null, { status: 204 })
      case 'GET /api/agents/agt_remy/crypto-sends':
        return json({ sends })
      case 'POST /api/agents/agt_remy/crypto-sends/cs_9/approve':
        return json({ ...QUOTE, id: 'cs_9', status: 'sending' })
      case 'POST /api/agents/agt_remy/wallet-moves/quote':
        return json(MOVE(String(body.route)))
      case 'POST /api/agents/agt_remy/wallet-moves/wm_cash_out/challenge':
        return json({ challenge: 'ch_cashout', allow_credentials: [] })
      case 'POST /api/agents/agt_remy/wallet-moves/wm_cash_out/confirm':
        return json(MOVE('cash_out', 'posted'))
      case 'POST /api/agents/agt_remy/wallet-moves/wm_card/confirm':
        return json(MOVE('card', 'posted'))
      case 'GET /api/money/payees':
        return json({ payees: [{ id: 'payee_own', name: 'My Monzo', country: 'GB', needs_confirmation: false, iban: 'GB33BUKB20201555555555' }] })
      case 'GET /api/agents/agt_remy/wallet/activity':
        return json({ lines: [{ entry_id: 'e1', line: 1, at: '2026-11-24T10:00:00Z', account_name: 'chain:base', currency: 'USDC', kind: 'crypto_in', amount_minor: 25_000_000, counterparty: TO, ref: `${TX}:3` }] })
      case 'GET /api/agents/agt_remy/crypto-requests':
        return json({ requests: [] })
      case 'POST /api/agents/agt_remy/crypto-requests':
        return json({ id: 'cr_1', token: 'USDC', network: 'base', amount_minor: 40_000_000, memo: body.memo, expires_at: body.expires_at, status: 'open', link: 'https://pay.talyvor.com/r/cr_1', uri: `ethereum:${USDC_ON_BASE}@8453/transfer?address=${ADDRESS}&uint256=40000000` })
      case 'GET /api/agents/agt_remy/spend-permission':
        return json(PERMISSION)
      case 'POST /api/agents/agt_remy/spend-permission/prepare': {
        const p = { ...body, ...lensChanges }
        const canonical = JSON.stringify({ version: 'v1', workspace_id: 'ws_1', agent_id: 'agt_remy', account: ADDRESS, number: 4, permission: p })
        return json({ canonical, challenge: 'not-the-hash' })
      }
      case 'PUT /api/agents/agt_remy/spend-permission':
        return json({ ...PERMISSION, number: 4, permission: JSON.parse(String(body.canonical)).permission })
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  mockStore.clear()
  mockSigned.length = 0
  mockCancel = false
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dev_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
})

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const open = async (action?: string) => {
  await renderRouter('./src/app', { initialUrl: action ? `/agent-wallet/agt_remy?open=${action}` : '/agent-wallet/agt_remy' })
  return within(await screen.findByTestId('agent-wallet'))
}
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }))

test('the balance and how to pay into the wallet: the address, its QR code, its network and Copy', async () => {
  mockBff()
  const wallet = await open()
  expect(wallet.getByText('Remy’s wallet')).toBeTruthy()
  expect(wallet.getByLabelText('125.50 USDC')).toBeTruthy()
  expect(wallet.getByText('Send USDC on Base to this address. Money sent on another network is lost.')).toBeTruthy()
  expect(wallet.getByLabelText('QR code of Remy’s USDC address')).toBeTruthy()
  expect(wallet.getByText(ADDRESS)).toBeTruthy()
  expect(wallet.getByRole('button', { name: 'Copy address' })).toBeTruthy()
})

test('B57.220: the wallet in Pocket: its face, the balance with its label, round actions, Activity and Limits as rows, the address in facts', async () => {
  mockBff()
  const wallet = await open()
  const head = within(wallet.getByTestId('agent-wallet-head'))
  expect(head.getByText('Remy’s wallet')).toBeTruthy()
  expect(head.getByLabelText('Remy agent')).toBeTruthy()
  const balance = within(wallet.getByTestId('agent-wallet-balance-USDC'))
  expect(balance.getByText('Balance')).toBeTruthy()
  expect(balance.getByLabelText('125.50 USDC')).toBeTruthy()
  expect(await balance.findByTestId('money-label-sandbox')).toBeTruthy()
  const rounds = within(wallet.getByTestId('agent-wallet-rounds-USDC'))
  expect(rounds.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Top up', 'Cash out', 'Send', 'Request'])
  const rows = within(wallet.getByTestId('agent-wallet-rows-USDC'))
  expect(rows.getByRole('button', { name: 'Activity' })).toBeTruthy()
  expect(rows.getByRole('button', { name: 'Limits and permissions' })).toBeTruthy()
  const facts = within(wallet.getByTestId('wallet-address-facts'))
  expect(facts.getByText('Address')).toBeTruthy()
  expect(facts.getByText('Base')).toBeTruthy()
  expect(facts.getByRole('button', { name: 'Copy address' })).toBeTruthy()

  // A round opens its part under the rounds, and says it is open; pressed again, it closes.
  await fireEvent.press(rounds.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(rounds.getByRole('button', { name: 'Send' }).props.accessibilityState).toMatchObject({ expanded: true }))
  expect(await screen.findByLabelText('Amount in USDC')).toBeTruthy()
  await fireEvent.press(rounds.getByRole('button', { name: 'Send' }))
  expect(screen.queryByLabelText('Amount in USDC')).toBeNull()
  // A row opens its part under the rows.
  await fireEvent.press(rows.getByRole('button', { name: 'Activity' }))
  expect(await screen.findByTestId('wallet-activity-USDC')).toBeTruthy()
})

test('a send is signed by this phone’s key over Lens’s challenge, then goes once under its key; a cancelled check sends nothing', async () => {
  const calls = mockBff()
  await open('send')
  await fireEvent.changeText(screen.getByLabelText('Wallet address, name.eth, saved name, @name, email or phone'), TO)
  await fireEvent.changeText(screen.getByLabelText('Amount in USDC'), '2.5')
  await press('Review')
  const quote = within(await screen.findByTestId('crypto-send-quote'))
  expect(quote.getByText('Paid from your network fee budget', { exact: false })).toBeTruthy()
  expect(screen.getByText('A new address: this workspace has not paid it before.')).toBeTruthy()
  expect(screen.getByText('Arrives in about 12 seconds')).toBeTruthy()

  mockCancel = true
  await press('Send with Face ID')
  expect(await screen.findByText('Cancelled. Nothing was sent.')).toBeTruthy()
  expect(writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends')).toEqual([])

  mockCancel = false
  await press('Send with Face ID')
  await screen.findByTestId('crypto-send-receipt')
  expect(mockSigned).toHaveLength(1)
  expect(mockSigned[0].reason).toBe('Send 2.50 USDC to 0x2222…2222')
  expect(mockSigned[0].message).toBe('talyvor-device-v1:ch_send')
  const challenged = writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends/challenge')
  const sent = writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends')
  expect(sent).toHaveLength(1)
  expect(sent[0].body).toEqual({ to: TO, network: 'base', token: 'USDC', amount_minor: 2_500_000, assertion: { device_id: 'dev_1', challenge: 'ch_send', signature: 'sig' } })
  expect(sent[0].key).toMatch(/^key-/)
  // The challenge is asked for the same send under the same key every time, the cancelled one included.
  expect(challenged.map((c) => [c.body, c.key])).toEqual([
    [{ to: TO, network: 'base', token: 'USDC', amount_minor: 2_500_000 }, sent[0].key],
    [{ to: TO, network: 'base', token: 'USDC', amount_minor: 2_500_000 }, sent[0].key],
  ])
})

test('a yes to a send waiting for the owner, and its test amount, are signed by this phone’s key over Lens’s challenge', async () => {
  const calls = mockBff({ sends: [{ ...QUOTE, id: 'cs_9', agent_id: 'agt_remy', direction: 'out', status: 'awaiting_owner', created_at: '2026-11-25T08:00:00Z' }] })
  await open('send')
  const waiting = within(await screen.findByTestId('crypto-send-waiting-cs_9'))
  expect(waiting.getByText('Remy wants to send to a new address')).toBeTruthy()
  await fireEvent.press(waiting.getByRole('button', { name: 'Approve with Face ID' }))
  await waitFor(() => expect(writes(calls).map((c) => c.path)).toContain('/api/agents/agt_remy/crypto-sends/cs_9/approve'))
  expect(mockSigned).toEqual([{ message: 'talyvor-device-v1:ch_yes', reason: 'Send 2.50 USDC to 0x2222…2222' }])
  const yes = writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends/cs_9/approve')
  expect(yes.map((c) => c.body)).toEqual([{ assertion: { device_id: 'dev_1', challenge: 'ch_yes', signature: 'sig' } }])

  await fireEvent.press(waiting.getByRole('button', { name: 'Send a test amount first' }))
  await fireEvent.changeText(screen.getByLabelText('Test amount in USDC'), '0.1')
  await press('Send the test amount')
  await waitFor(() => expect(writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends/cs_9/approve')).toHaveLength(2))
  expect(writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends/cs_9/approve/challenge').map((c) => c.body)).toEqual([{}, { test_amount_minor: 100_000 }])
  expect(writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends/cs_9/approve')[1].body).toEqual({
    test_amount_minor: 100_000,
    assertion: { device_id: 'dev_1', challenge: 'ch_test', signature: 'sig' },
  })
})

test('a send to a name.eth shows the address it resolved to, and that address is what is signed for', async () => {
  const calls = mockBff({ quote: { ...QUOTE, to: TO, ens_name: 'northwind.eth', to_label: 'northwind.eth' } })
  await open('send')
  await fireEvent.changeText(screen.getByLabelText('Wallet address, name.eth, saved name, @name, email or phone'), 'northwind.eth')
  await fireEvent.changeText(screen.getByLabelText('Amount in USDC'), '2.5')
  await press('Review')
  const quote = within(await screen.findByTestId('crypto-send-quote'))
  expect(quote.getByText('northwind.eth')).toBeTruthy()
  expect(quote.getByText(TO)).toBeTruthy()
  await press('Send with Face ID')
  await screen.findByTestId('crypto-send-receipt')
  expect(mockSigned.map((s) => s.reason)).toEqual(['Send 2.50 USDC to northwind.eth (0x2222…2222)'])
  const sent = writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends')
  expect(sent.map((c) => c.body)).toEqual([{ to: 'northwind.eth', network: 'base', token: 'USDC', amount_minor: 2_500_000, assertion: { device_id: 'dev_1', challenge: 'ch_send', signature: 'sig' } }])
})

test('a name.eth that points elsewhere by the time it is signed sends nothing and signs nothing', async () => {
  const calls = mockBff({ quote: { ...QUOTE, to: TO, ens_name: 'northwind.eth' }, challengeTo: '0x3333333333333333333333333333333333333333' })
  await open('send')
  await fireEvent.changeText(screen.getByLabelText('Wallet address, name.eth, saved name, @name, email or phone'), 'northwind.eth')
  await fireEvent.changeText(screen.getByLabelText('Amount in USDC'), '2.5')
  await press('Review')
  await screen.findByTestId('crypto-send-quote')
  await press('Send with Face ID')
  expect(await screen.findByText('northwind.eth now goes to 0x3333333333333333333333333333333333333333, not the address you reviewed. Nothing was sent: review it again.')).toBeTruthy()
  expect(mockSigned).toEqual([])
  expect(writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends')).toEqual([])
})

test('a saved address sends by its name; the owner saves and removes addresses', async () => {
  const calls = mockBff({ quote: { ...QUOTE, to: TO, saved_name: 'Treasury', to_label: 'Treasury' } })
  await open('send')
  const book = within(await screen.findByTestId('crypto-address-book'))
  await fireEvent.press(await book.findByText('Treasury'))
  expect(screen.getByLabelText('Wallet address, name.eth, saved name, @name, email or phone').props.value).toBe('Treasury')
  await fireEvent.changeText(screen.getByLabelText('Amount in USDC'), '2.5')
  await press('Review')
  const quote = within(await screen.findByTestId('crypto-send-quote'))
  expect(quote.getByText('Treasury')).toBeTruthy()
  expect(quote.getByText(TO)).toBeTruthy()
  await press('Send with Face ID')
  await screen.findByTestId('crypto-send-receipt')
  expect(writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends').map((c) => c.body?.to)).toEqual(['Treasury'])

  const again = within(await screen.findByTestId('crypto-address-book'))
  await fireEvent.changeText(again.getByLabelText('Name'), 'Payroll')
  await fireEvent.changeText(again.getByLabelText('Address'), ADDRESS)
  await fireEvent.press(again.getByRole('button', { name: 'Save address' }))
  await fireEvent.press(again.getByRole('button', { name: 'Remove Treasury' }))
  await waitFor(() => expect(writes(calls).filter((c) => c.path.startsWith('/api/crypto-addresses')).map((c) => [c.method, c.path, c.body])).toEqual([
    ['POST', '/api/crypto-addresses', { name: 'Payroll', address: ADDRESS }],
    ['DELETE', '/api/crypto-addresses/caddr_1', undefined],
  ]))
})

test('B57.221: Send in Pocket: saved addresses their own card on their initials, a waiting send the agent’s face with who it goes to by name', async () => {
  mockBff({ sends: [{ ...QUOTE, to: TO, saved_name: 'Treasury', id: 'cs_9', agent_id: 'agt_remy', direction: 'out', status: 'awaiting_owner', created_at: '2026-11-25T08:00:00Z' }] })
  await open('send')
  const form = within(await screen.findByTestId('wallet-send-form'))
  expect(form.getByText('Send')).toBeTruthy()
  expect(form.queryByTestId('crypto-address-book')).toBeNull()
  const book = within(await screen.findByTestId('crypto-address-book'))
  expect(await book.findByTestId('crypto-address-caddr_1-initial')).toBeTruthy()
  const waiting = within(await screen.findByTestId('crypto-send-waiting-cs_9'))
  expect(waiting.getByLabelText('Remy agent')).toBeTruthy()
  expect(waiting.getByLabelText('2.50 USDC')).toBeTruthy()
  const to = within(waiting.getByTestId('crypto-send-waiting-cs_9-to'))
  expect(to.getByText('Treasury')).toBeTruthy()
  expect(to.getByText(TO)).toBeTruthy()
  const sent = within(await screen.findByTestId('crypto-sends'))
  expect(sent.getByText('To Treasury')).toBeTruthy()
})

test('with no key for this workspace on this phone, a send is signed nowhere here: it says where, and nothing goes', async () => {
  mockStore.delete('talyvor.device-key')
  const calls = mockBff({ passkeys: ['cred_1'] })
  await open('send')
  await fireEvent.changeText(screen.getByLabelText('Wallet address, name.eth, saved name, @name, email or phone'), TO)
  await fireEvent.changeText(screen.getByLabelText('Amount in USDC'), '2.5')
  await press('Review')
  await screen.findByTestId('crypto-send-quote')
  await press('Send with Face ID')
  expect(await screen.findByText('Sign this on the web with your passkey, or turn on Approve with Face ID on this phone.')).toBeTruthy()
  expect(writes(calls).filter((c) => c.path === '/api/agents/agt_remy/crypto-sends')).toEqual([])
})

test('a top up by card is quoted, then confirmed once, unsigned', async () => {
  const calls = mockBff()
  await open('top-up')
  await fireEvent.changeText(screen.getByLabelText('Amount in GBP'), '10')
  await press('Review')
  const quote = within(await screen.findByTestId('wallet-move-quote'))
  expect(quote.getByText('Remy gets')).toBeTruthy()
  expect(quote.getByText('1 GBP = 1.2700 USDC')).toBeTruthy()
  await press('Confirm')
  expect(await screen.findByText('Added: 12.60 USDC is in Remy’s wallet.')).toBeTruthy()
  expect(writes(calls).map((c) => [c.path, c.body])).toEqual([
    ['/api/agents/agt_remy/wallet-moves/quote', { route: 'card', amount_minor: 1_000, currency: 'GBP' }],
    ['/api/agents/agt_remy/wallet-moves/wm_card/confirm', {}],
  ])
  expect(mockSigned).toEqual([])
})

test('a cash out is signed by this phone’s key over Lens’s challenge for exactly that move', async () => {
  const calls = mockBff()
  await open('cash-out')
  await press('My Monzo')
  await fireEvent.changeText(screen.getByLabelText('Amount in USDC'), '10')
  await press('Review')
  await screen.findByTestId('wallet-move-quote')
  expect(screen.getByText('Face ID asks before anything moves.')).toBeTruthy()
  await press('Confirm with Face ID')
  expect(await screen.findByText('Cashed out: £7.80 is on its way to your bank account.')).toBeTruthy()
  expect(mockSigned).toEqual([{ message: 'talyvor-device-v1:ch_cashout', reason: 'Cash out 10.00 USDC' }])
  const confirm = writes(calls).find((c) => c.path === '/api/agents/agt_remy/wallet-moves/wm_cash_out/confirm')
  expect(confirm?.body).toEqual({ assertion: { device_id: 'dev_1', challenge: 'ch_cashout', signature: 'sig' } })
})

test('a request is a link and a QR code to pay', async () => {
  const calls = mockBff()
  await open('request')
  await fireEvent.changeText(screen.getByLabelText('Amount in USDC'), '40')
  await fireEvent.changeText(screen.getByLabelText('What it is for'), 'November research')
  await press('Make the link')
  const link = within(await screen.findByTestId('wallet-request-link'))
  expect(link.getByLabelText('QR code to pay Remy November research')).toBeTruthy()
  expect(link.getByText('Share this link, or have the payer scan the code. It asks for 40.00 USDC on Base.')).toBeTruthy()
  expect(link.getByText('https://pay.talyvor.com/r/cr_1')).toBeTruthy()
  const made = writes(calls).find((c) => c.path === '/api/agents/agt_remy/crypto-requests')
  expect(made?.body).toMatchObject({ token: 'USDC', network: 'base', amount_minor: 40_000_000, memo: 'November research' })
  expect(made?.key).toMatch(/^key-/)
})

test('activity lists each posting, a payment on the chain with its explorer link', async () => {
  mockBff()
  await open('activity')
  const activity = within(await screen.findByTestId('wallet-activity-USDC'))
  expect(activity.getByText('+25.00 USDC')).toBeTruthy()
  expect(activity.getByText(/See it on the explorer/)).toBeTruthy()
})

test('new limits and Freeze are signed by this phone’s key, which owns the agent’s account', async () => {
  const calls = mockBff()
  await open('limits')
  expect(await screen.findByText('50.00 USDC a week')).toBeTruthy()
  await fireEvent.changeText(screen.getByLabelText('Allowance in USDC'), '80')
  await press('Sign new limits with Face ID')
  expect(await screen.findByText('Signed. Remy’s new limits hold from now.')).toBeTruthy()
  const prepared = writes(calls).filter((c) => c.path === '/api/agents/agt_remy/spend-permission/prepare')
  expect(prepared[0].body).toMatchObject({ tokens: [{ token: USDC_ON_BASE, allowance: 80_000_000, period: 'week', per_payment: 10_000_000 }], expires: '2027-06-30T23:59:59Z' })
  const put = writes(calls).filter((c) => c.method === 'PUT')
  const canonical = String(put[0].body?.canonical)
  // Signed over the phone's own hash of exactly the JSON it checked, never the challenge it was handed.
  expect(put[0].body).toEqual({ canonical, assertion: { device_id: 'dev_1', challenge: challengeOf(canonical), signature: 'sig' } })
  expect(mockSigned[0]).toEqual({ message: `talyvor-device-v1:${challengeOf(canonical)}`, reason: 'Sign Remy’s new limits' })

  await press('Freeze Remy')
  expect(await screen.findByText('Remy’s wallet is frozen. Every payment from it is refused until you sign new limits.')).toBeTruthy()
  expect(writes(calls).filter((c) => c.path.endsWith('/prepare'))[1].body).toMatchObject({ tokens: [] })
  expect(mockSigned[1].reason).toBe('Freeze Remy')
})

test('limits Lens prepared other than the ones set are never signed', async () => {
  const calls = mockBff({ lensChanges: { allowed: [TO] } })
  await open('limits')
  await screen.findByText('50.00 USDC a week')
  await press('Freeze Remy')
  expect(await screen.findByText('What this phone was asked to sign is not the limits you set, so nothing was signed.')).toBeTruthy()
  expect(writes(calls).filter((c) => c.method === 'PUT')).toEqual([])
  expect(mockSigned).toEqual([])
})

test('limits a passkey owns are changed on the web: nothing is prepared or signed', async () => {
  const calls = mockBff({ owner: { role: 'person', credential_id: 'cred_web' } })
  await open('limits')
  await screen.findByText('50.00 USDC a week')
  await press('Freeze Remy')
  expect(await screen.findByText('The passkey that owns Remy’s wallet signs its limits. Change them on the web.')).toBeTruthy()
  expect(writes(calls)).toEqual([])
  expect(mockSigned).toEqual([])
})

test('a push about the wallet opens the part it is about', () => {
  expect(walletHref({ type: 'crypto_send_new_address', agent_id: 'agt_remy', send_id: 'cs_9' })).toEqual({ pathname: '/agent-wallet/[id]', params: { id: 'agt_remy', open: 'send' } })
  expect(walletHref({ type: 'agent_wallet_money_in', agent_id: 'agt_remy' })).toEqual({ pathname: '/agent-wallet/[id]', params: { id: 'agt_remy', open: 'activity' } })
  expect(walletHref({ type: 'crypto_request_paid', agent_id: 'agt_remy' })).toEqual({ pathname: '/agent-wallet/[id]', params: { id: 'agt_remy', open: 'request' } })
  expect(walletHref({ type: 'spend_notice', agent_id: 'agt_remy' })).toBeNull()
})
