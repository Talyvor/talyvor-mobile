import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'

// B61.34 — Pay, to a person on the phone (the web's B61.33): "To a person" first on Pay, one field for a Talyvor name,
// phone number or email; a match shows the shown name Lens answers and nothing else, with Pay; nobody found says Lens's
// words. Pay opens the amount, the account it leaves and a note; one review, Send with Face ID over the challenge naming
// this payment, paid once under one key; then Sent, and the person is a chip under the field.

jest.setTimeout(60_000)

const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }))
jest.mock('../config', () => ({ config: { bffUrl: 'https://bff.test', oidcIssuer: 'https://idp', oidcClientId: 'mobile' } }))
let mockUUID = 0
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => `key-${++mockUUID}` }))
/** The phone's key: every message it signed, and the reason Face ID showed. */
const mockPhone = { signed: [] as string[], reasons: [] as string[] }
jest.mock('../../modules/talyvor-keys', () => ({
  isAvailable: () => true,
  sign: async (_: string, message: string, reason: string) => {
    mockPhone.signed.push(message)
    mockPhone.reasons.push(reason)
    return 'sig'
  },
  deleteKey: async () => undefined,
}))

const NOBODY = 'Nobody found. Check the name or number, or ask them to turn on being found in Settings.'
const accounts = [
  { id: 'acc_usd', currency: 'USD', purpose: 'company', status: 'open', name: '', balance_minor: 200_000, test_minor: 0, live_minor: 200_000 },
  { id: 'acc_eur', currency: 'EUR', purpose: 'company', status: 'open', name: '', balance_minor: 50_000, test_minor: 0, live_minor: 50_000 },
  { id: 'acc_r_usd', agent_id: 'ag_1', currency: 'USD', purpose: 'agent', status: 'open', name: 'Research · USD', balance_minor: 1_000, test_minor: 0, live_minor: 1_000 },
]

/** Every write the screens sent: its method and path, and its body. */
let writes: { call: string; body: Record<string, unknown> }[] = []

/** `pay` answers each payment POST in turn: 'ok', 'dropped' (the answer never arrives) or a Lens refusal. */
function mockBff(pay: ('ok' | 'dropped' | { status: number; error: string })[] = ['ok']) {
  writes = []
  const answers = [...pay]
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const [path] = url.replace('https://bff.test', '').split('?')
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    const call = `${init.method ?? 'GET'} ${path}`
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (init.method === 'POST') writes.push({ call, body })
    switch (call) {
      case 'POST /api/money/people/find':
        if (body.to === 'dana' || body.to === 'dana.reyes') return json({ shown_name: 'Dana R.' })
        if (body.to === 'many') return json({ error: 'economy: too many lookups this hour. Try again in an hour.' }, 429)
        return json({ error: NOBODY }, 404)
      case 'POST /api/money/people/pay/challenge':
        return json({ challenge: `ch-${String(body.idempotency_key)}`, allow_credentials: ['dk_1'] })
      case 'POST /api/money/people/pay': {
        const a = answers.shift() ?? 'ok'
        if (a === 'dropped') throw new TypeError('Network request failed')
        if (a !== 'ok') return json({ error: a.error }, a.status)
        return json({ id: 'pp_1', to_shown_name: 'Dana R.', from_account_id: body.account_id, amount_minor: body.amount_minor, currency: body.currency, note: body.note, idempotency_key: body.idempotency_key, created_at: '2026-11-16T10:00:00Z' })
      }
      case 'GET /auth/me':
        return json({ workspace_id: 'ws_1' })
      case 'GET /api/workspace/account':
        return json({ account_type: 'personal', money_kind: 'fiat' })
      case 'GET /api/workspace/areas':
        return json({ areas: [] })
      case 'GET /api/payees':
        return json({ payees: [] })
      case 'GET /api/money/payments':
        return json({ payments: [] })
      case 'GET /api/money/accounts':
        return json({ accounts })
      case 'GET /api/agents/approvals':
        return json({ approvals: [] })
    }
    return json({ error: 'no' }, 404)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockStore.clear()
  mockStore.set('talyvor.session', JSON.stringify({ token: 'session-1', expires_at: '2099-01-01T00:00:00Z' }))
  mockStore.set('talyvor.device-key', 'dk_1')
  mockStore.set('talyvor.device-workspace', 'ws_1')
  Object.assign(mockPhone, { signed: [], reasons: [] })
})

const finds = () => writes.filter((w) => w.call === 'POST /api/money/people/find')
const pays = () => writes.filter((w) => w.call === 'POST /api/money/people/pay')

test('the field: "To a person" comes first on Pay, and Find waits for something typed', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/pay' })
  const card = within(await screen.findByTestId('pay-a-person'))
  expect(card.getByText('To a person')).toBeTruthy()
  const find = card.getByRole('button', { name: 'Find' })
  expect(find.props.accessibilityState).toEqual({ disabled: true })
  expect(find.props.accessibilityHint).toBe('Type a name, phone number or email first.')
  await fireEvent.changeText(card.getByLabelText('Name, phone number or email'), '  ')
  await fireEvent.press(find)
  expect(finds()).toEqual([])
})

test('a match shows the shown name Lens answers, with Pay, and Find gives way to it', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/pay' })
  const card = within(await screen.findByTestId('pay-a-person'))
  await fireEvent.changeText(card.getByLabelText('Name, phone number or email'), ' dana ')
  await fireEvent.press(card.getByRole('button', { name: 'Find' }))
  const found = within(await screen.findByTestId('pay-a-person-found'))
  expect(found.getByText('Dana R.')).toBeTruthy()
  expect(found.getByText('On Talyvor')).toBeTruthy()
  expect(found.getByRole('button', { name: 'Pay Dana R.' })).toBeTruthy()
  expect(card.queryByRole('button', { name: 'Find' })).toBeNull()
  expect(finds()).toEqual([{ call: 'POST /api/money/people/find', body: { to: 'dana' } }])
})

test("no match says Lens's words, and so does the lookup limit", async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/pay' })
  const card = within(await screen.findByTestId('pay-a-person'))
  await fireEvent.changeText(card.getByLabelText('Name, phone number or email'), '+44 7700 900999')
  await fireEvent.press(card.getByRole('button', { name: 'Find' }))
  expect(await screen.findByText(NOBODY)).toBeTruthy()
  expect(screen.queryByTestId('pay-a-person-found')).toBeNull()
  await fireEvent.changeText(card.getByLabelText('Name, phone number or email'), 'many')
  expect(screen.queryByText(NOBODY)).toBeNull()
  await fireEvent.press(card.getByRole('button', { name: 'Find' }))
  expect(await screen.findByText('Too many lookups this hour. Try again in an hour.')).toBeTruthy()
})

test('the pay sheet: amount, account and note, one review, Send with Face ID, paid once under one key, then a chip', async () => {
  mockBff(['dropped', 'ok'])
  await renderRouter('./src/app', { initialUrl: '/pay' })
  const card = within(await screen.findByTestId('pay-a-person'))
  await fireEvent.changeText(card.getByLabelText('Name, phone number or email'), 'dana')
  await fireEvent.press(card.getByRole('button', { name: 'Find' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Pay Dana R.' }))

  expect(await screen.findByText('Pay Dana')).toBeTruthy()
  expect(screen.getByText('On Talyvor')).toBeTruthy()
  // The account's own accounts only, never an agent's.
  await fireEvent.press(screen.getByRole('button', { name: 'From Your account · $2,000.00' }))
  const from = within(await screen.findByTestId('pay-a-person-from'))
  expect(from.getAllByRole('button', { name: /^Your account · / }).map((b) => b.props.accessibilityLabel)).toEqual(['Your account · USD, $2,000.00', 'Your account · EUR, €500.00'])
  await fireEvent.press(from.getByRole('button', { name: 'Your account · USD, $2,000.00' }))
  const review = screen.getByRole('button', { name: 'Review' })
  expect(review.props.accessibilityState).toEqual({ disabled: true })
  await typeOnPad('42')
  await fireEvent.changeText(screen.getByLabelText('Note'), ' Dinner ')
  await fireEvent.press(review)

  const sheet = within(await screen.findByTestId('pay-a-person-review'))
  expect(sheet.getByText('Check and send')).toBeTruthy()
  expect(sheet.getByText('to Dana R.')).toBeTruthy()
  for (const [label, value] of [['From', 'Your account'], ['Arrives', 'In seconds'], ['Fee', '$0.00'], ['They get', '$42.00'], ['Note', 'Dinner']]) {
    expect(sheet.getByText(label)).toBeTruthy()
    expect(sheet.getAllByText(value).length).toBeGreaterThan(0)
  }
  expect(pays()).toEqual([])

  // The first answer is dropped: the second press goes under the same key, so Lens pays once.
  await fireEvent.press(sheet.getByRole('button', { name: 'Send with Face ID' }))
  expect(await screen.findByText('Nothing changed. You can try again.')).toBeTruthy()
  await fireEvent.press(sheet.getByRole('button', { name: 'Send with Face ID' }))
  expect(await screen.findByText('Sent')).toBeTruthy()
  expect(screen.getByText('$42.00 to Dana R. It is there now.')).toBeTruthy()

  expect(pays()).toHaveLength(2)
  const sent = { to: 'dana', amount_minor: 4200, currency: 'USD', account_id: 'acc_usd', note: 'Dinner', idempotency_key: expect.stringMatching(/^key-/) }
  expect(pays()[0].body).toEqual({ ...sent, assertion: { device_id: 'dk_1', challenge: expect.stringMatching(/^ch-key-/), signature: 'sig' } })
  expect(pays()[1].body.idempotency_key).toBe(pays()[0].body.idempotency_key)
  // The challenge names this payment, and the phone signed exactly it after Face ID.
  const challenge = writes.find((w) => w.call === 'POST /api/money/people/pay/challenge')!
  expect(challenge.body).toEqual(sent)
  expect(mockPhone.signed[0]).toBe(`talyvor-device-v1:ch-${String(pays()[0].body.idempotency_key)}`)
  expect(mockPhone.reasons[0]).toBe('Pay Dana R. $42.00')

  await fireEvent.press(screen.getByRole('button', { name: 'Done' }))
  const chips = within(await screen.findByTestId('pay-a-person-paid'))
  expect(chips.getByRole('button', { name: 'Pay Dana R. again' })).toBeTruthy()
})

// B61.77 — Check and send is a sheet over the amount; Close returns to it with nothing sent.
test('Check and send opens as a sheet, and Close returns to the amount with nothing sent', async () => {
  mockBff(['ok'])
  await renderRouter('./src/app', { initialUrl: '/pay' })
  const card = within(await screen.findByTestId('pay-a-person'))
  await fireEvent.changeText(card.getByLabelText('Name, phone number or email'), 'dana')
  await fireEvent.press(card.getByRole('button', { name: 'Find' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Pay Dana R.' }))
  await screen.findByLabelText('Amount in USD')
  await typeOnPad('42')
  await fireEvent.press(screen.getByRole('button', { name: 'Review' }))
  expect(await screen.findByTestId('pay-a-person-review')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByTestId('pay-a-person-review')).toBeNull())
  expect(screen.getByLabelText('Amount in USD')).toBeTruthy()
  expect(pays()).toEqual([])
})

test("a refusal is said in Lens's words, and nothing is said to be sent", async () => {
  mockBff([{ status: 409, error: 'economy: Dana R. holds no account in EUR, so nothing was sent' }])
  await renderRouter('./src/app', { initialUrl: '/pay-person?to=dana' })
  await screen.findByLabelText('Amount in USD')
  await typeOnPad('5')
  await fireEvent.press(screen.getByRole('button', { name: 'Review' }))
  await fireEvent.press(await screen.findByRole('button', { name: 'Send with Face ID' }))
  expect(await screen.findByText('Dana R. holds no account in EUR, so nothing was sent.')).toBeTruthy()
  expect(screen.queryByText('Sent')).toBeNull()
})

test('with no key on this phone, nothing is sent and the sheet offers Approvals on this phone', async () => {
  mockBff()
  mockStore.delete('talyvor.device-key')
  await renderRouter('./src/app', { initialUrl: '/pay-person?to=dana' })
  await screen.findByLabelText('Amount in USD')
  await typeOnPad('5')
  await fireEvent.press(screen.getByRole('button', { name: 'Review' }))
  const sheet = within(await screen.findByTestId('pay-a-person-review'))
  expect(sheet.queryByRole('button', { name: 'Send with Face ID' })).toBeNull()
  expect(sheet.getByRole('button', { name: 'Approvals on this phone' })).toBeTruthy()
  await waitFor(() => expect(pays()).toEqual([]))
})

test('a link names nobody: the screen names the person only as Lens answers for what it carries', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/pay-person?to=dana.reyes&name=Mum' })
  expect(await screen.findByText('Pay Dana')).toBeTruthy()
  expect(screen.queryByText(/Mum/)).toBeNull()
  expect(finds()).toEqual([{ call: 'POST /api/money/people/find', body: { to: 'dana.reyes' } }])
  await renderRouter('./src/app', { initialUrl: '/pay-person?to=someone' })
  expect(await screen.findByText(NOBODY)).toBeTruthy()
  expect(screen.queryByLabelText('Amount in USD')).toBeNull()
})

/** Presses the amount pad's keys in turn, as a person types an amount on it. */
async function typeOnPad(keys: string) {
  for (const k of keys) await fireEvent.press(screen.getByRole('button', { name: k === '.' ? 'Decimal point' : k === '<' ? 'Delete' : k }))
}

test('B57.183: Pay and Pay a person are drawn as Pocket Live draws them: the pill, the one row, the amount on the keypad, Sent at the foot', async () => {
  mockBff()
  await renderRouter('./src/app', { initialUrl: '/pay' })
  const card = within(await screen.findByTestId('pay-a-person'))
  // The search pill: its words are its placeholder, with no label above it that says them again.
  const pill = card.getByLabelText('Name, phone number or email')
  expect(pill.props.placeholder).toBe('Name, phone number or email')
  expect(card.queryAllByText('Name, phone number or email')).toEqual([])
  await fireEvent.changeText(pill, 'dana')
  await fireEvent.press(card.getByRole('button', { name: 'Find' }))
  // The person found is one row to press, as the reference's rows are: no Pay button of its own.
  const found = within(await screen.findByTestId('pay-a-person-found'))
  expect(found.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Pay Dana R.'])
  expect(found.queryByText('Pay')).toBeNull()
  await fireEvent.press(found.getByRole('button', { name: 'Pay Dana R.' }))

  // The amount is the big figure, typed on the keypad: $0 until a key is pressed.
  expect(await screen.findByText('Pay Dana')).toBeTruthy()
  const amount = screen.getByLabelText('Amount in USD')
  expect(amount.props.children).toBe('$0')
  expect(screen.queryByPlaceholderText('0.00')).toBeNull()
  await typeOnPad('12345.678')
  // Two places at most, a thousands comma, and Delete takes the last key back.
  expect(screen.getByLabelText('Amount in USD').props.children).toBe('$12,345.67')
  await typeOnPad('<<<<<<<<<42')
  expect(screen.getByLabelText('Amount in USD').props.children).toBe('$42')
  // Review sits at the foot with the keypad, and more than the account holds is said, with no sheet.
  const foot = within(screen.getByTestId('screen-footer'))
  expect(foot.getByRole('button', { name: 'Delete' })).toBeTruthy()
  await typeOnPad('000')
  expect(screen.getByLabelText('Amount in USD').props.children).toBe('$42,000')
  await fireEvent.press(foot.getByRole('button', { name: 'Review' }))
  expect(await screen.findByText('That is more than this account holds')).toBeTruthy()
  expect(screen.queryByTestId('pay-a-person-review')).toBeNull()
  await typeOnPad('<<<')
  expect(screen.queryByText('That is more than this account holds')).toBeNull()
  await fireEvent.press(foot.getByRole('button', { name: 'Review' }))
  await fireEvent.press(within(await screen.findByTestId('pay-a-person-review')).getByRole('button', { name: 'Send with Face ID' }))

  // Sent: the tick, the line, and Done and See it in Activity at the foot.
  expect(await screen.findByText('Sent')).toBeTruthy()
  expect(pays().map((p) => p.body.amount_minor)).toEqual([4200])
  const done = within(screen.getByTestId('screen-footer'))
  expect(done.getAllByRole('button').map((b) => b.props.children ?? b.props.accessibilityLabel)).toHaveLength(2)
  expect(done.getByRole('button', { name: 'Done' })).toBeTruthy()
  expect(done.getByRole('button', { name: 'See it in Activity' })).toBeTruthy()
})
