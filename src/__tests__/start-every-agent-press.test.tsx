import { StartEveryAgentSheet } from '../components/start-every-agent'
import { pressEverything } from '../testing/press-everything'

// B57.71 — pressEverything on the "Start every agent again?" sheet, with this phone's key on and off.

const mockGo = { said: (_: string) => undefined as void }
jest.mock('../session', () => ({ useSession: () => ({ client: {}, peg: 0.1, signedIn: true }) }))
jest.mock('expo-router', () => ({ router: { push: (to: string) => mockGo.said(to) } }))
jest.mock('../keys', () => ({
  ...jest.requireActual('../keys'),
  resumeWithThisPhone: async () => {
    mockGo.said('signed resume-all')
    return null
  },
}))

test.each([
  ['on', true, 3],
  ['off', false, 3],
])("the sheet with this phone's key %s: every button does something", async (_, signs, pressed) => {
  const report = await pressEverything((said) => {
    mockGo.said = said
    return <StartEveryAgentSheet visible signs={signs} onClose={() => said('close')} onStarted={() => said('started')} />
  })
  expect(report.dead).toEqual([])
  // Close, then Start them with Face ID or Approvals on this phone, then Not now
  expect(report.pressed).toBe(pressed)
})
