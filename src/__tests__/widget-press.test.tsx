import WidgetAction from '../app/widget'
import { pressEverything } from '../testing/press-everything'

// B57.77 — pressEverything on the in-app widget route: a link that did not come from the widget leaves a way out.

const mockGo = { said: (_: string) => undefined as void }
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ do: 'pause', agent: 'ag_1', t: 'forged' }),
  router: { canGoBack: () => false, back: () => mockGo.said('back'), replace: (to: unknown) => mockGo.said(JSON.stringify(to)) },
}))
jest.mock('../session', () => ({ useSession: () => ({ client: { pause: async () => mockGo.said('paused') } }) }))
jest.mock('../widget-sync', () => ({ widgetLinkValid: async () => false, syncWidget: async () => undefined }))

test('every control on the widget route does something', async () => {
  const report = await pressEverything((said) => {
    mockGo.said = said
    return <WidgetAction />
  })
  expect(report.pressed).toBeGreaterThan(0)
  expect(report.dead).toEqual([])
})
