import { refusalText } from '@talyvor/bff-client'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'

import { Body, Eyebrow, Screen } from '@/components/ui'
import { useSession } from '@/session'
import { syncWidget, widgetLinkValid } from '@/widget-sync'

/** Where the home-screen widget's Pause lands: pause the agent in Lens, refresh the widget, show the agent. */
export default function WidgetAction() {
  const params = useLocalSearchParams<{ do?: string; agent?: string; t?: string }>()
  const { client } = useSession()
  const [said, setSaid] = useState('Pausing…')

  useEffect(() => {
    let live = true
    const { do: action, agent, t } = params
    void (async () => {
      if (action !== 'pause' || !agent || !(await widgetLinkValid(t))) {
        if (live) setSaid('This link did not come from your Talyvor widget, so nothing changed.')
        return
      }
      try {
        await client.pause(agent, 'Paused from the home-screen widget')
        await syncWidget(client)
        if (live) router.replace({ pathname: '/agents/[id]', params: { id: agent } })
      } catch (err) {
        if (live) setSaid(refusalText(err))
      }
    })()
    return () => {
      live = false
    }
  }, [client, params])

  return (
    <Screen>
      <Eyebrow>Widget</Eyebrow>
      <Body>{said}</Body>
    </Screen>
  )
}
