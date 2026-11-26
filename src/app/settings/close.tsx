import { BffError } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native'

import { CardTitle, Lead, MessageBox, SaidLine, SentList, useRequests, useSend } from '@/components/account-requests'
import { SheetCover } from '@/components/lock-screen'
import { Back, Body, Button, Card, Field, Headline, Screen, Sheet, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B59.29 — /settings/close, the web's Close this account (suite B59.28): what must be empty first, and the request to
// close. Lens refuses it while any balance is not empty, and the refusal names each one. B57.140: what was asked comes before the form.
// B52.47 — and Delete your account, as the web's (suite B52.38, B57.209): asks once, with the email typed back.
// B57.226 — in Pocket, as Pocket Live draws its close-account sheet (SH.closeAcct): no tangerine edge, the line in ink-2,
// Keep my account in ink and the red button as .btn.danger; the words stay the web's.

export default function CloseAccountScreen() {
  const requests = useRequests()
  const [message, setMessage] = useState('')
  const close = useSend(
    () => ({ title: 'Asked', line: 'A person at Talyvor closes the account and answers on this page.' }),
    () => {
      setMessage('')
      requests.reload()
    },
  )

  return (
    <Screen onRefresh={requests.reload} refreshing={requests.loading && !!requests.data}>
      <Back home="/settings" />
      <Headline>Close this account</Headline>
      <Lead>What must be empty first, and asking to close</Lead>
      <Body muted>Before the account can close, every balance must be empty: the account’s own, each agent’s, and any money set aside. Move the money out first.</Body>
      <Body muted>A person at Talyvor closes the account and answers on this page. Only the account’s owner can ask.</Body>
      <SentList requests={requests} kinds={['account_closure']} title="What you asked" empty="You have not asked to close this account." />
      <Card>
        <CardTitle>Ask to close</CardTitle>
        <MessageBox label="Anything we should know (optional)" value={message} onChange={setMessage} />
        <SaidLine said={close.said} />
        <Button variant="danger" label={close.sending ? 'Sending…' : 'Ask to close this account'} disabled={close.sending} onPress={() => void close.send('account_closure', message)} />
      </Card>
      <DeleteYourAccount />
    </Screen>
  )
}

/** What a failed deletion says: Lens's or the BFF's sentence, as the web's dialog shows it. */
function notDeleted(err: unknown): string {
  if (err instanceof BffError && err.status === 401) return 'Nothing was deleted. Sign in again.'
  if (err instanceof BffError && err.sentence) return err.sentence
  return 'Nothing was deleted. You can try again.'
}

/** Deletes every account the person holds, then signs them out everywhere; on this phone the session ends with it. */
function DeleteYourAccount() {
  const { c } = useTheme()
  const { client, deleteAccount } = useSession()
  const me = useLoad(useCallback(() => client.authMe(), [client]))
  const [asking, setAsking] = useState(false)
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [refusal, setRefusal] = useState('')
  // The BFF asks for the email back, or DELETE from a person signed in without one (suite apps/bff/account_delete.go).
  const confirm = me.data?.user?.email || 'DELETE'
  const matches = typed.trim().toLowerCase() === confirm.toLowerCase()
  const keep = () => {
    if (deleting) return
    setAsking(false)
    setTyped('')
    setRefusal('')
  }
  const gone = async () => {
    if (deleting || !matches) return
    setDeleting(true)
    setRefusal('')
    try {
      await deleteAccount(typed)
      // This screen is not one the signed-in guard holds (app/_layout.tsx), so the first screen is opened here.
      router.replace('/sign-in')
    } catch (err) {
      setRefusal(notDeleted(err))
      setDeleting(false)
    }
  }
  return (
    <Card>
      <CardTitle>Delete your account</CardTitle>
      <Body muted>
        Deletes every account you hold and signs you out everywhere: every browser, every phone and every connected assistant. It can’t be undone. Billing and ledger
        records, statements included, are kept as the law requires.
      </Body>
      <Button variant="soft-danger" label="Delete your account" onPress={() => setAsking(true)} />
      <Modal visible={asking} transparent animationType="slide" onRequestClose={keep}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: c.scrim }}>
          <Pressable accessible={false} style={{ flex: 1 }} onPress={keep} />
          <Sheet edge={false}>
            <View testID="delete-account-sheet" style={{ gap: 14 }}>
              <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.44, color: c.ink }}>
                Delete your account?
              </Text>
              <Body muted>Every account you hold is deleted, and every browser, phone and connected assistant is signed out. This can’t be undone.</Body>
              <Field label={`Type ${confirm} to confirm`} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} />
              {refusal ? (
                <View accessibilityRole="alert">
                  <Body style={{ color: c.danger }}>{refusal}</Body>
                </View>
              ) : null}
              <Button variant="primary" label="Keep my account" disabled={deleting} onPress={keep} />
              <Button variant="soft-danger" label={deleting ? 'Deleting…' : 'Yes, delete my account'} disabled={!matches || deleting} onPress={() => void gone()} />
            </View>
          </Sheet>
        </KeyboardAvoidingView>
        <SheetCover />
      </Modal>
    </Card>
  )
}
