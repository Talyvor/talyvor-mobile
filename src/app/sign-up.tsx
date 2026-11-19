import { Image } from 'expo-image'
import { BffError } from '@talyvor/bff-client'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { CARDS, type CardFace } from '@/cards'
import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { MoneyLabel, useMoneyLabels } from '@/components/money-label'
import { PasscodePad } from '@/components/passcode-pad'
import { CountryField, FieldError, countryRefusal } from '@/components/country-field'
import { IdentityChecks } from '@/components/identity-checks'
import { Body, Button, Field, Headline, Screen } from '@/components/ui'
import { DOOR_WORDS, doorRefusal } from '@/door-words'
import { keysAvailable, turnOnFaceID } from '@/keys'
import { useSession } from '@/session'
import {
  ACCOUNT_TYPES,
  IDENTITY_WORDS,
  KIND_NOTE,
  MONEY_KINDS,
  PROFILE_ERRORS,
  PROFILE_LABELS,
  SIGNUP_STEPS,
  TYPE_NOTE,
  kindFor,
  type AccountType,
  type MoneyKind,
} from '@/signup-words'
import { fonts, useTheme } from '@/theme'

// sign-up.tsx — B59.9: a new person opens an account on the phone, with the web's words (suite B59.8; the design's P1
// and P2). Lens sets the type and the kind only on the call that makes the workspace, so the BFF refuses a partial set.
// Step 3 makes this phone's key with Face ID, through the same card Approvals uses.
//
// B57.135 — drawn in Pocket as the launch pack's P1 and P2: the logo (or Back) with Sandbox at the top, the step bars,
// each type on its card face, and the decisions held at the foot. Step 3 is not drawn there, so it takes the same look.
//
// B61.21 — step 4 is the identity check, as the web's B61.20: Lens's checks against the Sandbox provider, and Home only
// once they pass. A Business's company details moved here from step 3, beside the check they go to.
//
// B61.10 — "Open another account", from Your accounts (?another=1): a person already signed in walks steps 1 and 2, the
// BFF's POST /api/accounts (suite B61.8) opens the account and moves the session to it, and the identity check runs for
// it, as the web's B61.9. The key step is left out: this phone's key is the person's already.
//
// B61.27 — sign-up starts at the door: the number, the code and a passcode open a sign-up session (suite B61.25), and
// steps 1 and 2 choose its account with POST /auth/signup/account. Step 3 is Pocket Live's `su6`: one key made with
// Face ID, kept as the account's approval key and the person's sign-in key, with the passcode just chosen as Lens's proof.
//
// The name is the workspace's name. Country and the registration number are asked as the spec says, and kept on this
// screen only: Lens has nowhere to hold them yet (the web does the same).

/** Why Continue waits: nothing is picked yet. */
const PICK_TYPE = 'Pick who this account is for.'
const PICK_KIND = 'Pick the kind of money.'
const SAVE_FAILED = 'We couldn’t save that. Nothing changed.'
const OPEN_FAILED = 'The account didn’t open. Try again.'

/** Another account's steps: sign-up's, without the key. */
const ANOTHER_STEPS = [SIGNUP_STEPS[0], SIGNUP_STEPS[1], SIGNUP_STEPS[3]] as const
type StepList = readonly string[]

/** Lens's own sentence for a refusal it worded (the eleventh account), and otherwise ours. */
const openFailure = (err: unknown) => (err instanceof BffError && err.sentence && err.status < 500 ? err.sentence : OPEN_FAILED)

interface Profile {
  name: string
  companyName: string
  registrationNumber: string
  country: string
}

/** B61.111 — a country Lens refused (country_not_served), and Lens's sentence for it. */
interface Refused {
  country: string
  sentence: string
}

const EMPTY: Profile = { name: '', companyName: '', registrationNumber: '', country: '' }

/** What step 1 still lacks, as P1's error lines, keyed by field. */
function missing(type: AccountType, p: Profile): Partial<Record<keyof Profile, string>> {
  const out: Partial<Record<keyof Profile, string>> = {}
  if (type === 'personal' && !p.name.trim()) out.name = PROFILE_ERRORS.name
  if (type === 'business' && !p.companyName.trim()) out.companyName = PROFILE_ERRORS.companyName
  if (type === 'business' && !p.registrationNumber.trim()) out.registrationNumber = PROFILE_ERRORS.registrationNumber
  if (!p.country) out.country = PROFILE_ERRORS.country
  return out
}

/** The Sandbox label, read from Lens's public labels for every money capability; nothing until Lens answers. */
function SandboxLabel() {
  const labels = useMoneyLabels()
  return <MoneyLabel capability={Object.keys(labels ?? {})} />
}

/** The top of each step (P1, P2's .phead): the logo, or Back where there is a step behind, and Sandbox on the right. */
function Header({ onBack }: { onBack?: () => void }) {
  const { c, dark } = useTheme()
  return (
    <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ width: 48, height: 48, marginLeft: -14, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <Icon name="chev" color={c.ink} />
          </View>
        </Pressable>
      ) : (
        <Image
          source={dark ? require('../../assets/logo/talyvor-logo-small-on-dark-480.png') : require('../../assets/logo/talyvor-logo-small-on-light-480.png')}
          style={{ width: 132, height: 42 }}
          contentFit="contain"
          accessibilityLabel="Talyvor"
        />
      )}
      <View>
        <SandboxLabel />
      </View>
    </View>
  )
}

type StepAt = 1 | 2 | 3 | 4

/** The phone's step bars: a bar a step, tangerine when reached, then "Step n of 4" (of 3, for another account). */
function Steps({ at, steps = SIGNUP_STEPS }: { at: StepAt; steps?: StepList }) {
  const { c } = useTheme()
  const of = steps.length
  return (
    <View accessible accessibilityLabel={`Step ${at} of ${of}, ${steps[at - 1]}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {steps.map((_, i) => (
        <View key={i} style={{ width: 28, height: 6, borderRadius: 3, backgroundColor: i < at ? c.tangerine : c.cloud2 }} />
      ))}
      <Text style={{ marginLeft: 6, fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }}>{`Step ${at} of ${of}`}</Text>
    </View>
  )
}

/** The card face each type opens with (P1): Daily for Personal, Team for Business. */
const TYPE_FACE: Record<AccountType, CardFace> = {
  personal: CARDS.find((f) => f.id === 'daily')!,
  business: CARDS.find((f) => f.id === 'team')!,
}

/** The choice card (P1, P2): radio semantics; cloud when off, white with a 2px ink ring when on; the dot leads, a face may end it. */
function Choice({ picked, onPick, title, line, face, children }: { picked: boolean; onPick: () => void; title: string; line: string; face?: CardFace; children?: ReactNode }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${title}. ${line}`}
      accessibilityState={{ checked: picked }}
      onPress={onPick}
      style={{ borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: face ? 'center' : 'flex-start', gap: 14, backgroundColor: picked ? c.page : c.cloud, borderWidth: 2, borderColor: picked ? c.ink : c.cloud }}>
      <View style={{ width: 18, height: 18, marginTop: face ? 0 : 2, borderRadius: 9, borderWidth: 1.5, borderColor: picked ? c.ink : c.control, backgroundColor: picked ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {picked ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.page }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 16.5, lineHeight: 22, color: c.ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: c.ink2 }}>{line}</Text>
        {children}
      </View>
      {face ? (
        <View testID={`choice-face-${face.id}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Card face={face} holder="" sub="" width={84} />
        </View>
      ) : null}
    </Pressable>
  )
}

/** A note under the choices (P1, P2's faint small line). */
function Note({ children }: { children: string }) {
  const { c } = useTheme()
  return <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: c.ink3 }}>{children}</Text>
}

/** Step 1 (P1): who the account is for, and the profile for that type. */
function StepWho({ type, setType, profile, setProfile, onContinue, another, refused }: {
  type: AccountType | null
  setType: (t: AccountType) => void
  profile: Profile
  setProfile: (p: Profile) => void
  onContinue: () => void
  /** B61.10 — a person signed in, opening another account: Back leaves, and there is no signing in instead. */
  another: boolean
  /** B61.111 — the country Lens refused and its sentence, said on Country until another is picked. */
  refused: Refused | null
}) {
  const [tried, setTried] = useState(false)
  const errors = type && tried ? missing(type, profile) : {}
  const countryRefused = refused && refused.country === profile.country ? refused.sentence : null
  const set = (field: keyof Profile) => (v: string) => setProfile({ ...profile, [field]: v })
  const field = (f: 'name' | 'companyName' | 'registrationNumber') => (
    <View key={f} style={{ gap: 6 }}>
      <Field
        label={PROFILE_LABELS[f]}
        value={profile[f]}
        onChangeText={set(f)}
        maxLength={80}
        autoComplete={f === 'name' ? 'name' : f === 'companyName' ? 'organization' : 'off'}
        autoCapitalize={f === 'registrationNumber' ? 'characters' : 'words'}
      />
      {errors[f] ? <FieldError>{errors[f]}</FieldError> : null}
    </View>
  )
  return (
    <Screen
      footer={
        <>
          <Button
            primary
            label="Continue"
            disabled={!type}
            hint={PICK_TYPE}
            onPress={() => {
              if (!type) return
              setTried(true)
              if (!Object.keys(missing(type, profile)).length && !countryRefused) onContinue()
            }}
          />
        </>
      }>
      <Header onBack={another ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined} />
      <Steps at={1} steps={another ? ANOTHER_STEPS : SIGNUP_STEPS} />
      <Headline>{SIGNUP_STEPS[0]}</Headline>
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {ACCOUNT_TYPES.map((t) => (
          <Choice key={t.value} picked={type === t.value} onPick={() => setType(t.value)} title={t.title} line={t.line} face={TYPE_FACE[t.value]} />
        ))}
      </View>
      {type ? (
        <View style={{ gap: 14 }}>
          {type === 'personal' ? field('name') : [field('companyName'), field('registrationNumber')]}
          <CountryField value={profile.country} onChange={set('country')} error={errors.country ?? countryRefused ?? undefined} />
        </View>
      ) : null}
      <Note>{TYPE_NOTE}</Note>
    </Screen>
  )
}

/** Step 2 (P2): the kind of money. Continue goes to the identity provider, then to the BFF with every answer. */
function StepKind({ type, name, kind, setKind, busy, failed, onContinue, onBack, another }: {
  type: AccountType
  name: string
  kind: MoneyKind | null
  setKind: (k: MoneyKind) => void
  busy: boolean
  /** what went wrong, in words; null when nothing did */
  failed: string | null
  onContinue: () => void
  onBack: () => void
  /** B61.10 — Continue opens another account for the person signed in, rather than going to the identity provider. */
  another: boolean
}) {
  const { c } = useTheme()
  return (
    <Screen
      footer={
        <>
          {failed ? <FieldError>{failed}</FieldError> : null}
          <Button primary label={busy ? (another ? 'Opening…' : 'Saving…') : failed ? 'Try again' : 'Continue'} disabled={!kind || busy} hint={kind ? undefined : PICK_KIND} onPress={onContinue} />
        </>
      }>
      <Header onBack={busy ? undefined : onBack} />
      <Steps at={2} steps={another ? ANOTHER_STEPS : SIGNUP_STEPS} />
      <Headline>{SIGNUP_STEPS[1]}</Headline>
      <Body muted>{kindFor(name, type)}</Body>
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {MONEY_KINDS.map((k) => (
          <Choice key={k.value} picked={kind === k.value} onPick={() => setKind(k.value)} title={k.title} line={k.line}>
            <View style={{ marginTop: 8, gap: 6 }}>
              {k.list(type).map((item) => (
                <View key={item} style={{ flexDirection: 'row', gap: 8 }}>
                  <Icon name="check" size={16} color={c.ink} />
                  <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: c.ink }}>{item}</Text>
                </View>
              ))}
            </View>
          </Choice>
        ))}
      </View>
      <Note>{KIND_NOTE}</Note>
    </Screen>
  )
}

/** Step 3 (Pocket Live `su6`): Face ID, or later. The key it makes approves payments and unlocks the app; Lens takes it
 * with the passcode just chosen, or the one typed here when the app was opened again since. Either way the identity check
 * follows. */
function StepKey({ onContinue }: { onContinue: () => void }) {
  const { client, takeNewPasscode } = useSession()
  const { c } = useTheme()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const [round, setRound] = useState(0)
  const make = async (passcode: string) => {
    setBusy(true)
    setFailed('')
    try {
      await turnOnFaceID(client, passcode)
      onContinue()
    } catch (err) {
      setFailed(err instanceof BffError ? doorRefusal(err) : DOOR_WORDS.failed)
      setAsking(err instanceof BffError && err.code === 'wrong_passcode')
      setRound((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }
  const on = () => {
    const p = takeNewPasscode()
    if (p) void make(p)
    else setAsking(true)
  }
  return (
    <Screen
      footer={
        asking ? (
          failed ? <FieldError>{failed}</FieldError> : null
        ) : (
          <>
            {failed ? <FieldError>{failed}</FieldError> : null}
            <Button primary icon="faceid" label={DOOR_WORDS.faceID.on} disabled={busy || !keysAvailable()} onPress={on} />
            <Button variant="ghost" label={DOOR_WORDS.faceID.later} disabled={busy} onPress={onContinue} />
          </>
        )
      }>
      <Header />
      <Steps at={3} />
      {asking ? (
        <>
          <Headline>{DOOR_WORDS.enter.title}</Headline>
          <PasscodePad onDone={make} disabled={busy} reset={round} />
        </>
      ) : (
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 40 }}>
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.cloud2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="faceid" size={48} color={c.ink} />
          </View>
          <Headline>{DOOR_WORDS.faceID.title}</Headline>
          <Text style={{ maxWidth: 300, textAlign: 'center', fontFamily: fonts.ui, fontSize: 15, lineHeight: 22, color: c.ink2 }}>{DOOR_WORDS.faceID.line}</Text>
        </View>
      )}
    </Screen>
  )
}

/** B65.3 — back from the identity partner's page with a pass, the app goes on to Home. */
const toHome = () => router.replace('/')

/** Step 4 (B61.21): the identity check. The app opens on Home once Lens's checks for the account pass, and (B61.118)
 * while one waits or after one did not pass, with a line that says so. B57.174: drawn
 * as Pocket Live's su5, under the same top and step bars as the steps before it. */
function StepConfirm({ another }: { another: boolean }) {
  return (
    // B59.32 — a Business gives its company details and the people with control here, beside the check they go to.
    <IdentityChecks
      head={
        <>
          <Header />
          {another ? <Steps at={3} steps={ANOTHER_STEPS} /> : <Steps at={4} />}
          <Headline>{SIGNUP_STEPS[3]}</Headline>
        </>
      }
      done={<Button primary label={IDENTITY_WORDS.open} onPress={() => router.replace('/')} />}
      wayIn
      onPassed={toHome}
    />
  )
}

export default function SignUp() {
  const { signedIn, joining, finishSignup, openAccount } = useSession()
  const another = useLocalSearchParams<{ another?: string }>().another === '1'
  const [step, setStep] = useState<StepAt>(1)
  const [type, setType] = useState<AccountType | null>(null)
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [kind, setKind] = useState<MoneyKind | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [refused, setRefused] = useState<Refused | null>(null)
  // Someone already signed in has an account: this screen is for opening one, so Home shows instead. Once this sign-up has
  // started, the session it makes is its own and steps 3 and 4 follow.
  const [started, setStarted] = useState(false)
  // Another account is opened beside one the person has, so only someone signed in can open one. B61.27: a sign-up
  // starts at the door, which opens the sign-up session these steps finish.
  if (!signedIn) return <Redirect href="/sign-in" />
  if (!another && !joining && !started) return <Redirect href="/" />

  const name = (type === 'personal' ? profile.name : profile.companyName).trim()

  // B61.111 — Lens does not serve the country: step 1 again, its sentence on Country.
  const backToCountry = (err: unknown) => {
    const sentence = countryRefusal(err)
    if (!sentence) return false
    setRefused({ country: profile.country, sentence })
    setStep(1)
    return true
  }

  const open = async () => {
    if (!type || !kind) return
    setBusy(true)
    setFailed(null)
    try {
      await openAccount({ type, kind, name, country: profile.country, ...(type === 'business' ? { registration_number: profile.registrationNumber.trim() } : {}) })
      setStep(4)
    } catch (err) {
      if (backToCountry(err)) return
      setFailed(openFailure(err))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!type || !kind) return
    setBusy(true)
    setFailed(null)
    try {
      setStarted(true)
      await finishSignup({ type, kind, name, country: profile.country, ...(type === 'business' ? { registration_number: profile.registrationNumber.trim() } : {}) })
      setStep(3)
    } catch (err) {
      setStarted(false)
      if (backToCountry(err)) return
      setFailed(SAVE_FAILED)
    } finally {
      setBusy(false)
    }
  }

  return step === 4 ? (
    <StepConfirm another={another} />
  ) : step === 3 ? (
    <StepKey onContinue={() => setStep(4)} />
  ) : step === 2 && type ? (
    <StepKind type={type} name={name} kind={kind} setKind={setKind} busy={busy} failed={failed} onContinue={() => void (another ? open() : finish())} onBack={() => setStep(1)} another={another} />
  ) : (
    <StepWho type={type} setType={setType} profile={profile} setProfile={setProfile} onContinue={() => setStep(2)} another={another} refused={refused} />
  )
}
