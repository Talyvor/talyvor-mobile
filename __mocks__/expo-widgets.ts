// Jest: the home-screen widget and the lock screen's Live Activities, which only a phone can draw. Each started activity
// is kept here with every content it was given, so a test reads what the lock screen would show and when it ended.
export interface MockActivity {
  id: string
  url?: string
  props: Record<string, unknown>
  ended?: { dismissal: unknown; props?: Record<string, unknown> }
}
export const mockActivities: MockActivity[] = []

export const createWidget = () => ({ updateSnapshot: () => undefined })
export const createLiveActivity = () => ({
  start: (props: Record<string, unknown>, url?: string) => {
    const a: MockActivity = { id: `act_${mockActivities.length + 1}`, url, props }
    mockActivities.push(a)
    return { getId: () => a.id }
  },
  getInstances: () =>
    mockActivities
      .filter((a) => !a.ended)
      .map((a) => ({ getId: () => a.id, end: async (dismissal: unknown, props?: Record<string, unknown>) => void (a.ended = { dismissal, props }) })),
})
