import { render, screen } from '@testing-library/react-native'

import { OwnerCard } from '../components/owner-card'

// B57.128 — the owner's or company's own card on the phone is drawn with its tier art (Nick, 10 Nov 2026): Daily for a
// personal account, Team for a business account and Stablecoin Daily for a stablecoin-only account, whatever its type.

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => null) }))

test('a business account shows the Team face', async () => {
  await render(<OwnerCard account={{ account_type: 'business', money_kind: 'hybrid' }} holder="Northwind Studio" />)
  expect(screen.getByLabelText("Northwind Studio's Team corporate card")).toBeTruthy()
  expect(screen.getByText('For your team and its agents')).toBeTruthy()
})

test.each([
  ['personal', 'fiat', "Maya Lind's Daily personal card", 'Your everyday account'],
  ['personal', 'hybrid', "Maya Lind's Daily personal card", 'Your everyday account'],
  ['business', 'fiat', "Maya Lind's Team corporate card", 'For your team and its agents'],
  ['personal', 'stablecoin', "Maya Lind's Daily stablecoin card", 'Spends from your own wallet'],
  ['business', 'stablecoin', "Maya Lind's Daily stablecoin card", 'Spends from your own wallet'],
] as const)('a %s %s account shows its default face', async (account_type, money_kind, label, sub) => {
  await render(<OwnerCard account={{ account_type, money_kind }} holder="Maya Lind" />)
  expect(screen.getByLabelText(label)).toBeTruthy()
  expect(screen.getByText(sub)).toBeTruthy()
})
