import { KeyEnrolmentSheet } from '../components/key-enrolment-cards'
import { pressEverything } from '../testing/press-everything'

// B57.69 — pressEverything on the sheet that lets a browser in: Close, Let it approve and Not this one each do something.

const mockClient = {
  enrolmentChallenge: async () => ({ challenge: 'ch_enr_1' }),
  approveEnrolment: async () => ({}),
  declineEnrolment: async () => ({}),
}
jest.mock('../session', () => ({ useSession: () => ({ client: mockClient, peg: 0.1, signedIn: true }) }))
jest.mock('../keys', () => ({
  biometricName: 'Face ID',
  keyGone: () => false,
  keyGoneText: '',
  phoneKey: async () => ({ id: 'dev_1', here: true, owner: '' }),
  signWithThisPhone: async (_: unknown, challenge: string) => ({ device_id: 'dev_1', challenge, signature: 'signed' }),
}))

const enrolment = { id: 'enr_1', kind: 'passkey', name: 'Chrome on Mac', code: '042917', status: 'waiting', created_at: '2026-11-10T10:00:00Z', expires_at: '2026-11-10T10:10:00Z' }

test('the sheet letting a browser in: every control does something', async () => {
  const report = await pressEverything((said) => <KeyEnrolmentSheet enrolment={enrolment} onClose={() => said('closed')} onDecided={(approved) => said(approved ? 'let in' : 'turned away')} />)
  expect(report).toEqual({ pressed: 3, dead: [] })
})
