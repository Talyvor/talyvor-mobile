import { useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'

import { CardTitle } from '@/components/account-requests'
import { SheetCover } from '@/components/lock-screen'
import { Body, Button, Card, Sheet } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B57.225 — the web's Sign out everywhere (suite ConnectAI.tsx, B52.9 and B57.158), on the phone's Settings: it asks once,
// stays up while it signs out, and says so when it could not. Once the BFF has ended every sign-in, this phone's session
// ends with them and the signed-in guard (app/_layout.tsx) opens the sign-in screen.

export const EVERYWHERE_WORDS = {
  title: 'Sign out everywhere',
  line: 'Signs you out of Talyvor in every browser and on every phone, and disconnects every connected assistant. Each one has to sign in again.',
  ask: 'Sign out everywhere?',
  sheet: 'Every browser, every phone and every connected assistant has to sign in again.',
  cancel: 'Cancel',
  yes: 'Yes, sign out everywhere',
  going: 'Signing out…',
  failed: 'You were not signed out anywhere. Try again.',
}

export function SignOutEverywhere() {
  const { c } = useTheme()
  const { signOutEverywhere } = useSession()
  const [asking, setAsking] = useState(false)
  const [going, setGoing] = useState(false)
  const [failed, setFailed] = useState(false)
  // While it signs out the sheet stays, as Cancel does: a sign-out under way cannot be hidden.
  const cancel = () => {
    if (going) return
    setAsking(false)
    setFailed(false)
  }
  const go = async () => {
    if (going) return
    setGoing(true)
    setFailed(false)
    try {
      await signOutEverywhere()
    } catch {
      setFailed(true)
      setGoing(false)
    }
  }
  return (
    <Card>
      <CardTitle>{EVERYWHERE_WORDS.title}</CardTitle>
      <Body muted>{EVERYWHERE_WORDS.line}</Body>
      <Button variant="secondary" label={EVERYWHERE_WORDS.title} onPress={() => setAsking(true)} />
      <Modal visible={asking} transparent animationType="slide" onRequestClose={cancel}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: c.scrim }}>
          <Pressable accessible={false} style={{ flex: 1 }} onPress={cancel} />
          <Sheet>
            <View testID="sign-out-everywhere-sheet" style={{ gap: 14 }}>
              <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: c.ink }}>
                {EVERYWHERE_WORDS.ask}
              </Text>
              <Body>{EVERYWHERE_WORDS.sheet}</Body>
              {failed ? (
                <View accessibilityRole="alert">
                  <Body style={{ color: c.danger }}>{EVERYWHERE_WORDS.failed}</Body>
                </View>
              ) : null}
              <Button variant="secondary" label={EVERYWHERE_WORDS.cancel} disabled={going} onPress={cancel} />
              <Button variant="danger" label={going ? EVERYWHERE_WORDS.going : EVERYWHERE_WORDS.yes} disabled={going} onPress={() => void go()} />
            </View>
          </Sheet>
        </View>
        <SheetCover />
      </Modal>
    </Card>
  )
}
