import { BffError, refusalText, type PersonFinding, type PersonFindingChange } from '@talyvor/bff-client'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'

import { FieldError } from '@/components/country-field'
import { Body, Button, Card, Field, Toggle } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// find-me.tsx — B61.94: the phone's twin of the web's B61.93 (talyvor-suite #1199, apps/web/src/areas/lens/FindMe.tsx),
// through the BFF's GET and POST /api/people/finding (Lens B61.32). Settings, Profile holds the person's Talyvor name
// and the three switches, by name, phone number and email, each off until pressed; the end of sign-up asks the one
// question once (Pocket Live `su7`, drawn in sign-up.tsx). Both draw what Lens RECORDED, from the answer to each write,
// never what was pressed, and a refusal (a name taken, one that reads like a name held, one kept for Talyvor) is said in
// Lens's words.

export const FIND_WORDS = {
  name: 'Your Talyvor name',
  nameHint: '3 to 20 letters a to z, digits, dots and underscores.',
  save: 'Save',
  saving: 'Saving…',
  findBy: 'Let people find me by',
  findByLine: 'Someone who finds you sees only your first name and the first letter of your last name.',
  byName: 'Name',
  byPhone: 'Phone number',
  byEmail: 'Email',
  nameFirst: 'Choose your Talyvor name first.',
  noPhone: 'Talyvor has no phone number for you yet.',
  noEmail: 'Talyvor has no email for you yet.',
  unread: 'Your settings for being found could not be read.',
  // Pocket Live `su7`, the end of sign-up
  question: 'Let people find you?',
  questionLine: 'So people can pay you by your name or phone number.',
  yes: 'Yes, find me',
  yesLine: 'By name or phone number, to pay me.',
  no: 'No',
  noLine: 'People need your account details to pay you.',
  open: 'Open my account',
}

/** Sign-up's Yes: found by name too once there is one, and by phone number. Nothing else is switched on. */
export const findMeYes = (f: PersonFinding): PersonFindingChange => (f.name ? { by_name: true, by_phone: true } : { by_phone: true })

/** Whether the end of sign-up asks: only a person who can be found by neither name nor number yet. */
export const askFindMe = (f: PersonFinding) => !f.by_name && !f.by_phone

/** Settings, Profile: the Talyvor name and who can find you, for a session the door opened (a person). */
export function FindMeSettings() {
  const { client, person } = useSession()
  const { c } = useTheme()
  const [f, setF] = useState<PersonFinding | null>(null)
  const [unread, setUnread] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  useEffect(() => {
    if (!person) return
    let live = true
    client.personFinding().then(
      (v) => {
        if (!live) return
        setF(v)
        setName(v.name)
      },
      // A session with no person yet is told, in the BFF's words, to confirm a phone number first.
      (err: unknown) => live && setUnread(err instanceof BffError && err.status === 409 && err.sentence ? err.sentence : FIND_WORDS.unread),
    )
    return () => {
      live = false
    }
  }, [client, person])
  if (!person) return null
  if (!f) return unread ? <Card><Body muted>{unread}</Body></Card> : null

  const change = async (ch: PersonFindingChange) => {
    setBusy(true)
    setFailed('')
    try {
      const now = await client.changePersonFinding(ch)
      setF(now)
      setName(now.name)
    } catch (err) {
      setFailed(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  const typed = name.trim()
  return (
    <View testID="settings-find-me">
      <Card>
        <Field label={FIND_WORDS.name} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} autoComplete="off" maxLength={21} />
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: c.ink3 }}>{FIND_WORDS.nameHint}</Text>
        {typed !== f.name ? <Button variant="outline" small label={busy ? FIND_WORDS.saving : FIND_WORDS.save} disabled={busy} onPress={() => void change({ name: typed })} /> : null}
        <Text accessibilityRole="header" style={{ marginTop: 8, fontFamily: fonts.uiBold, fontSize: 16, lineHeight: 22, color: c.ink }}>
          {FIND_WORDS.findBy}
        </Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: c.ink2 }}>{FIND_WORDS.findByLine}</Text>
        <Toggle
          label={FIND_WORDS.byName}
          sub={f.name ? `@${f.name}` : FIND_WORDS.nameFirst}
          value={f.by_name}
          disabled={busy || !f.name}
          onValueChange={(on) => void change({ by_name: on })}
        />
        <Toggle
          label={FIND_WORDS.byPhone}
          sub={f.phone || FIND_WORDS.noPhone}
          value={f.by_phone}
          disabled={busy || !f.phone}
          onValueChange={(on) => void change({ by_phone: on })}
        />
        <Toggle
          label={FIND_WORDS.byEmail}
          sub={f.email || FIND_WORDS.noEmail}
          value={f.by_email}
          disabled={busy || !f.email}
          onValueChange={(on) => void change({ by_email: on })}
        />
        {failed ? (
          <View accessibilityLiveRegion="polite">
            <FieldError>{failed}</FieldError>
          </View>
        ) : null}
      </Card>
    </View>
  )
}
