import { refusalText } from '@talyvor/bff-client'
import { useState } from 'react'

import { Body, Button, Eyebrow, Headline, Screen } from '@/components/ui'
import { useSession } from '@/session'

/** Where "Pause my agents in Talyvor" lands (B40.17): one tap stops every agent's next request or payment. */
export default function PauseAll() {
  const { client } = useSession()
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)

  const pause = async () => {
    setBusy(true)
    try {
      await client.pauseAll('Paused from a phone shortcut')
      setSaid('Every agent is paused. Nothing they ask for is paid until you resume them.')
    } catch (err) {
      setSaid(refusalText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Eyebrow>Pause agents</Eyebrow>
      <Headline>Pause every agent?</Headline>
      <Body muted>Each agent&apos;s next request or payment is refused until you resume them.</Body>
      {said ? <Body>{said}</Body> : <Button primary label={busy ? 'Pausing…' : 'Pause every agent'} disabled={busy} onPress={() => void pause()} />}
    </Screen>
  )
}
