import { exchangeCodeAsync, makeRedirectUri, useAuthRequest, useAutoDiscovery } from 'expo-auth-session'
import { Image } from 'expo-image'
import { Redirect, router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { CARDS, type CardFace } from '@/cards'
import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { MoneyLabel, useMoneyLabels } from '@/components/money-label'
import { PhoneKeyCard } from '@/components/phone-key-card'
import { Body, Button, Field, Headline, Row, Screen } from '@/components/ui'
import { config } from '@/config'
import { useSession } from '@/session'
import {
  ACCOUNT_TYPES,
  COUNTRIES,
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
// and P2). Steps 1 and 2 are asked BEFORE the identity provider, because Lens sets the type and the kind only on the call
// that makes the workspace: the answers ride the ID token to the BFF's /auth/mobile/session, which refuses a partial set.
// Step 3 makes this phone's key with Face ID, through the same card Approvals uses.
//
// B57.135 — drawn in Pocket as the launch pack's P1 and P2: the logo (or Back) with Sandbox at the top, the step bars,
// each type on its card face, and the decisions held at the foot. Step 3 is not drawn there, so it takes the same look.
//
// The name is the workspace's name. Country and the registration number are asked as the spec says, and kept on this
// screen only: Lens has nowhere to hold them yet (the web does the same).

WebBrowser.maybeCompleteAuthSession()

const redirectUri = makeRedirectUri({ scheme: 'talyvor', path: 'auth' })

/** Why Continue waits: nothing is picked yet. */
const PICK_TYPE = 'Pick who this account is for.'
const PICK_KIND = 'Pick the kind of money.'
const SAVE_FAILED = 'We couldn’t save that. Nothing changed.'

interface Profile {
  name: string
  companyName: string
  registrationNumber: string
  country: string
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

/** The phone's step bars: three bars, tangerine when reached, then "Step n of 3". */
function Steps({ at }: { at: 1 | 2 | 3 }) {
  const { c } = useTheme()
  return (
    <View accessible accessibilityLabel={`Step ${at} of 3, ${SIGNUP_STEPS[at - 1]}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {[1, 2, 3].map((n) => (
        <View key={n} style={{ width: 28, height: 6, borderRadius: 3, backgroundColor: n <= at ? c.tangerine : c.cloud2 }} />
      ))}
      <Text style={{ marginLeft: 6, fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }}>{`Step ${at} of 3`}</Text>
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

/** Red text always has an icon beside it. */
function FieldError({ children }: { children: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name="x" size={16} color={c.danger} />
      <Body style={{ color: c.danger, flex: 1 }}>{children}</Body>
    </View>
  )
}

/** Country: the web's list, opened in place. */
function CountryField({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const picked = COUNTRIES.find(([code]) => code === value)?.[1]
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }}>{PROFILE_LABELS.country}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={PROFILE_LABELS.country}
        accessibilityValue={picked ? { text: picked } : undefined}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 48, borderRadius: 14, borderWidth: 1.5, borderColor: c.control, backgroundColor: c.page, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: picked ? c.ink : c.ink3 }}>{picked ?? PROFILE_LABELS.country}</Text>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chev" size={16} color={c.ink2} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ borderRadius: 14, backgroundColor: c.cloud, paddingHorizontal: 14 }}>
          {COUNTRIES.map(([code, name], i) => (
            <Row
              key={code}
              first={i === 0}
              title={name}
              right={code === value ? <Icon name="check" size={16} color={c.ink} /> : undefined}
              onPress={() => {
                onChange(code)
                setOpen(false)
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

/** Step 1 (P1): who the account is for, and the profile for that type. */
function StepWho({ type, setType, profile, setProfile, onContinue }: {
  type: AccountType | null
  setType: (t: AccountType) => void
  profile: Profile
  setProfile: (p: Profile) => void
  onContinue: () => void
}) {
  const [tried, setTried] = useState(false)
  const errors = type && tried ? missing(type, profile) : {}
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
              if (!Object.keys(missing(type, profile)).length) onContinue()
            }}
          />
          <Button variant="ghost" label="Sign in instead" onPress={() => router.replace('/sign-in')} />
        </>
      }>
      <Header />
      <Steps at={1} />
      <Headline>{SIGNUP_STEPS[0]}</Headline>
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {ACCOUNT_TYPES.map((t) => (
          <Choice key={t.value} picked={type === t.value} onPick={() => setType(t.value)} title={t.title} line={t.line} face={TYPE_FACE[t.value]} />
        ))}
      </View>
      {type ? (
        <View style={{ gap: 14 }}>
          {type === 'personal' ? field('name') : [field('companyName'), field('registrationNumber')]}
          <View style={{ gap: 6 }}>
            <CountryField value={profile.country} onChange={set('country')} />
            {errors.country ? <FieldError>{errors.country}</FieldError> : null}
          </View>
        </View>
      ) : null}
      <Note>{TYPE_NOTE}</Note>
    </Screen>
  )
}

/** Step 2 (P2): the kind of money. Continue goes to the identity provider, then to the BFF with every answer. */
function StepKind({ type, name, kind, setKind, busy, failed, onContinue, onBack }: {
  type: AccountType
  name: string
  kind: MoneyKind | null
  setKind: (k: MoneyKind) => void
  busy: boolean
  failed: boolean
  onContinue: () => void
  onBack: () => void
}) {
  const { c } = useTheme()
  return (
    <Screen
      footer={
        <>
          {failed ? <FieldError>{SAVE_FAILED}</FieldError> : null}
          <Button primary label={busy ? 'Saving…' : failed ? 'Try again' : 'Continue'} disabled={!kind || busy} hint={kind ? undefined : PICK_KIND} onPress={onContinue} />
        </>
      }>
      <Header onBack={busy ? undefined : onBack} />
      <Steps at={2} />
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

/** Step 3: this phone's key, made with Face ID. The app opens once it is on, or later from Approvals. */
function StepKey() {
  const [on, setOn] = useState(false)
  const onOn = useCallback(() => setOn(true), [])
  return (
    <Screen
      footer={on ? <Button primary label="Open the app" onPress={() => router.replace('/')} /> : <Button variant="ghost" label="Do this later" onPress={() => router.replace('/')} />}>
      <Header />
      <Steps at={3} />
      <Headline>{SIGNUP_STEPS[2]}</Headline>
      <PhoneKeyCard onOn={onOn} />
    </Screen>
  )
}

export default function SignUp() {
  const { signedIn, signIn } = useSession()
  const discovery = useAutoDiscovery(config.oidcIssuer)
  const [request, , promptAsync] = useAuthRequest(
    { clientId: config.oidcClientId, redirectUri, scopes: ['openid', 'email', 'profile'] },
    discovery,
  )
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [type, setType] = useState<AccountType | null>(null)
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [kind, setKind] = useState<MoneyKind | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // Someone already signed in has an account: this screen is for opening one, so Home shows instead. Once this sign-up has
  // started, the session it makes is its own and step 3 follows.
  const [started, setStarted] = useState(false)
  if (signedIn && !started) return <Redirect href="/" />

  const name = (type === 'personal' ? profile.name : profile.companyName).trim()

  const finish = async () => {
    if (!type || !kind || !request || !discovery) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await promptAsync()
      if (result.type !== 'success') return
      const tokens = await exchangeCodeAsync(
        { clientId: config.oidcClientId, code: result.params.code, redirectUri, extraParams: { code_verifier: request.codeVerifier ?? '' } },
        discovery,
      )
      if (!tokens.idToken) throw new Error('no ID token')
      setStarted(true)
      await signIn(tokens.idToken, { account_type: type, money_kind: kind, name })
      setStep(3)
    } catch {
      setStarted(false)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return step === 3 ? (
    <StepKey />
  ) : step === 2 && type ? (
    <StepKind type={type} name={name} kind={kind} setKind={setKind} busy={busy} failed={failed} onContinue={() => void finish()} onBack={() => setStep(1)} />
  ) : (
    <StepWho type={type} setType={setType} profile={profile} setProfile={setProfile} onContinue={() => setStep(2)} />
  )
}
