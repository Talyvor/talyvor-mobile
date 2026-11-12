import { refusalText } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { View } from 'react-native'

import { Icon } from '@/components/icon'
import { StartEveryAgentButton, StartEveryAgentSheet, useSigns } from '@/components/start-every-agent'
import { Back, Body, Button, Headline, Screen, useLoad } from '@/components/ui'
import { biometricName } from '@/keys'
import { useSession } from '@/session'
import { useTheme } from '@/theme'

/** Pocket's p-pause-all (B57.71), from Home's Pause every agent and the "Pause my agents in Talyvor" shortcut (B40.17):
 * one tap stops every agent's next request or payment; starting them again is signed with this phone's key. */
export default function PauseAll() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(() => client.book(), [client])
  const { data, error } = useLoad(load)
  const signs = useSigns()
  const [paused, setPaused] = useState<boolean | null>(null)
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const allPaused = paused ?? !!data?.all_paused_at
  const home = () => (router.canDismiss() ? router.dismissTo('/') : router.replace('/'))

  const pause = async () => {
    setBusy(true)
    setSaid('')
    try {
      await client.pauseAll('Paused from the phone app')
      setPaused(true)
    } catch (err) {
      setSaid(refusalText(err))
    } finally {
      setBusy(false)
    }
  }

  // A failed read still lets the person pause: pausing is never what waits on a read.
  if (!data && !error) return <Screen>{null}</Screen>
  return (
    <Screen>
      <Back home="/" />
      <View style={{ gap: 14, paddingTop: 40 }}>
        <View style={{ alignSelf: 'center', width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud }}>
          <Icon name="pause" size={42} color={c.ink2} />
        </View>
        {allPaused ? (
          <>
            <Centred headline>Every agent is paused</Centred>
            <Centred>Nothing they ask for is paid until you start them again.</Centred>
            <StartEveryAgentButton signs={signs} onPress={() => setStarting(true)} />
            <Button variant="secondary" label="Home" onPress={home} />
          </>
        ) : (
          <>
            <Centred headline>Pause every agent?</Centred>
            <Centred>
              {signs === false
                ? `Each agent’s next request or payment is refused until you start them again, with your passkey on the web, or with ${biometricName} once approving is on here again.`
                : `Each agent’s next request or payment is refused until you start them again. Starting them again needs ${biometricName}.`}
            </Centred>
            <Button variant="danger" label={busy ? 'Pausing…' : 'Pause every agent'} disabled={busy} onPress={() => void pause()} />
            <Button variant="secondary" label="Not now" disabled={busy} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          </>
        )}
        {said ? <Body style={{ color: c.danger, textAlign: 'center' }}>{said}</Body> : null}
      </View>
      <StartEveryAgentSheet
        visible={starting}
        signs={signs}
        onClose={() => setStarting(false)}
        onStarted={() => {
          setStarting(false)
          setPaused(false)
          home()
        }}
      />
    </Screen>
  )
}

function Centred({ children, headline }: { children: string; headline?: boolean }) {
  return headline ? (
    <View style={{ alignItems: 'center' }}>
      <Headline>{children}</Headline>
    </View>
  ) : (
    <Body muted style={{ textAlign: 'center' }}>
      {children}
    </Body>
  )
}
