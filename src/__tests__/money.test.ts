import { createBffClient, formatBalance, formatLXC, formatMinor, MONEY_ORDER } from '@talyvor/bff-client'

import { widgetProps } from '../widget-sync'

// B55.27: the phone writes $450.00, dollars first beside LXC, and USDC to its six decimals.

test('currency amounts read $450.00, £12.50 and €3.00, with thousands and a leading minus', () => {
  expect(formatMinor(45000, 'USD')).toBe('$450.00')
  expect(formatMinor(1250, 'GBP')).toBe('£12.50')
  expect(formatMinor(300, 'EUR')).toBe('€3.00')
  expect(formatMinor(123456789, 'USD')).toBe('$1,234,567.89')
  expect(formatMinor(-400, 'USD')).toBe('-$4.00')
})

test('USDC counts six decimals: 1,500,000 is 1.50 USDC and every digit it holds is shown', () => {
  expect(formatMinor(1_500_000, 'USDC')).toBe('1.50 USDC')
  expect(formatMinor(400_000_000, 'USDC')).toBe('400.00 USDC')
  expect(formatMinor(1_234_567_891, 'USDC')).toBe('1,234.567891 USDC')
})

test('LXC is dollars first by the peg, LXC first when the switch flips, and LXC alone with no peg', () => {
  expect(MONEY_ORDER).toBe('usd-first')
  expect(formatLXC(900_000_000, 0.1)).toBe('$90.00 (900 LXC)')
  expect(formatLXC(900_000_000, 0.1, 'lxc-first')).toBe('900 LXC ($90.00)')
  expect(formatLXC(900_000_000, null)).toBe('900 LXC')
  expect(formatLXC(-40_000_000, 0.1)).toBe('-$4.00 (-40 LXC)')
})

// B59.36: a balance never shows more than it holds, so its dollars round down to the cent. An amount to approve or a
// charge keeps the nearest cent, as the web's figures do.
test('a balance of 1,255,000 µLXC at 0.1 USD per LXC reads $0.12; the same amount to approve reads $0.13', () => {
  const book = { workspace_balance_ulxc: 1_255_000, allocated_ulxc: 1_255_000, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'ag-1', name: 'Scout', balance_ulxc: 1_255_000, spent_ulxc: 0, created_at: '2026-11-11T00:00:00Z' }] }
  const widget = widgetProps(book, [], [], 'token-1', undefined, 0.1)
  expect(widget.safeToSpend).toBe('$0.12 (1.255 LXC)')
  expect(widget.agents[0].balance).toBe('$0.12 (1.255 LXC)')
  expect(formatBalance(1_255_000, 0.1)).toBe('$0.12 (1.255 LXC)')
  expect(formatBalance(1_255_000, 0.1, 'lxc-first')).toBe('1.255 LXC ($0.12)')
  expect(formatBalance(900_000_000, 0.1)).toBe('$90.00 (900 LXC)')
  expect(formatBalance(-1_255_000, 0.1)).toBe('-$0.13 (-1.255 LXC)')
  expect(formatBalance(1_255_000, null)).toBe('1.255 LXC')
  expect(formatLXC(1_255_000, 0.1)).toBe('$0.13 (1.255 LXC)')
})

test('the peg is read once from the top-up options, and a failed read leaves it unread', async () => {
  let reads = 0
  let up = false
  const fetchImpl = (async (url: string) => {
    reads++
    if (!url.endsWith('/api/lxc/topup-options') || !up) return new Response('{}', { status: 502 })
    return new Response(JSON.stringify({ usd_per_lxc: 0.1, min_usd_cents: 1000 }), { status: 200 })
  }) as unknown as typeof fetch
  const client = createBffClient('https://bff.test', () => 'session-1', fetchImpl)
  expect(await client.peg()).toBeNull()
  up = true
  expect(await client.peg()).toBe(0.1)
  expect(await client.peg()).toBe(0.1)
  expect(reads).toBe(2)
})
