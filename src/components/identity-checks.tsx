import { BffError, type BffClient, type VerificationBody, type VerificationCheck, type WorkspaceVerification } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'

import { useAccount } from '@/account'
import { CompanyDetailsSection } from '@/components/company-details'
import { CountryField, FieldError, countryRefusal } from '@/components/country-field'
import { Icon } from '@/components/icon'
import { Body, Button, Card, Chip, Field, Note, Screen } from '@/components/ui'
import { useSession } from '@/session'
import { IDENTITY_ERRORS, IDENTITY_WORDS } from '@/signup-words'
import { fonts, useTheme } from '@/theme'

// identity-checks.tsx — B61.21: "Confirm who you are", the last step of sign-up and Settings, Verification
// (/settings/verification), as the web's B61.20 has it (talyvor-suite PR #1120, apps/web/src/areas/lens/IdentityChecks.tsx
// at 99205a0). It runs Lens's checks in order (B30.4: email and phone, then the person, then for a Business its company,
// from the company details B59.32 saved) and shows each as it passes. No document is asked for: in Sandbox the details are
// checked alone, and the note says so.
//
// A Personal account is confirmed at L2, a Business at L3. Until then Home says so in one sentence (IdentityGate).
//
// B57.174 — drawn as Pocket Live's su5 (design/pocket-live, 15 Nov): the line, the fields with no card round them, the
// Sandbox note in place of the ID document's card, then the checks; the one main button at the foot, out of the scroll.

const LEVELS = ['L0', 'L1', 'L2', 'L3'] as const

/** 0 to 3 for "L0" to "L3"; -1 for anything else. */
const rank = (level: string | undefined) => LEVELS.indexOf(level as (typeof LEVELS)[number])

type Subject = 'contact' | 'person' | 'company'

const STEPS: readonly { subject: Subject; level: number; kind: VerificationBody['kind'] }[] = [
  { subject: 'contact', level: 1, kind: 'contact' },
  { subject: 'person', level: 2, kind: 'identity' },
  { subject: 'company', level: 3, kind: 'company' },
]

/** The level that confirms an account: a person's identity, and for a Business its company too. */
const neededLevel = (type: 'personal' | 'business') => (type === 'business' ? 3 : 2)

/** Lens's own check of a phone number (economy.e164). */
const E164 = /^\+[1-9][0-9]{7,14}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A check the provider has not decided yet, for the level after the one reached. */
const waitingOnNext = (v: WorkspaceVerification | null) =>
  (v?.checks ?? []).some((c) => c.status === 'pending' && rank(c.level) === rank(v?.level) + 1)

/** The newest check Lens has for a level. */
const latest = (v: WorkspaceVerification | null, level: number): VerificationCheck | undefined => (v?.checks ?? []).find((c) => rank(c.level) === level)

/** Lens's record, read again every 5 seconds while the next check waits on the provider. A read that fails draws nothing. */
function useVerification(client: BffClient) {
  const [v, setV] = useState<WorkspaceVerification | null>(null)
  const [failed, setFailed] = useState(false)
  const read = useCallback(() => client.verification().then((got) => (setV(got), setFailed(false)), () => setFailed(true)), [client])
  useEffect(() => {
    void read()
  }, [read])
  const waiting = waitingOnNext(v)
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void read(), 5000)
    return () => clearInterval(t)
  }, [waiting, read])
  return { v, setV, failed }
}

type ChipTone = Parameters<typeof Chip>[0]['tone']

/** What a step's row says, in words, and its chip's tone. */
function stateOf(v: WorkspaceVerification | null, level: number, running: boolean): { text: string; tone: ChipTone } {
  const c = latest(v, level)
  if (rank(v?.level) >= level) return { text: c?.test === false ? IDENTITY_WORDS.passed : IDENTITY_WORDS.passedSandbox, tone: 'good' }
  if (running) return { text: IDENTITY_WORDS.checking, tone: 'wait' }
  if (c?.status === 'pending') return { text: IDENTITY_WORDS.waiting, tone: 'wait' }
  if (c?.status === 'failed' || c?.status === 'returned') return { text: IDENTITY_WORDS.notPassed, tone: 'bad' }
  return { text: IDENTITY_WORDS.notYet, tone: 'plain' }
}

/** A check that did not pass, in words: what to fix. */
function failedText(c: VerificationCheck): string {
  if (/expired/i.test(c.detail ?? '')) return IDENTITY_ERRORS.expired
  return IDENTITY_ERRORS.failed[c.subject as Subject] ?? IDENTITY_ERRORS.unknown
}

/** Lens's refusal of a check, in words. */
function refusedText(err: unknown, subject: Subject): string {
  if (err instanceof BffError && err.status === 401) return 'Nothing changed. Sign in again.'
  if (err instanceof BffError && err.status < 500) return IDENTITY_ERRORS.failed[subject]
  return IDENTITY_ERRORS.unknown
}

const tidy = (s: string) => s.trim().split(/\s+/).join(' ').toLowerCase()

interface Draft {
  email: string
  phone: string
  name: string
  dob: string
  country: string
}

type Errors = Partial<Record<keyof Draft, string>>

function missing(d: Draft, level: number): Errors {
  const out: Errors = {}
  if (level < 1 && !EMAIL.test(d.email.trim())) out.email = IDENTITY_ERRORS.email
  if (level < 1 && !E164.test(d.phone.replace(/\s/g, ''))) out.phone = IDENTITY_ERRORS.phone
  if (level < 2 && !d.name.trim()) out.name = IDENTITY_ERRORS.legalName
  if (level < 2 && !/^\d{4}-\d{2}-\d{2}$/.test(d.dob.trim())) out.dob = IDENTITY_ERRORS.dateOfBirth
  if (level < 2 && !d.country) out.country = IDENTITY_ERRORS.country
  return out
}

function bodyFor(kind: VerificationBody['kind'], d: Draft): VerificationBody {
  if (kind === 'contact') return { kind, email: d.email.trim(), phone: d.phone.replace(/\s/g, '') }
  if (kind === 'identity') return { kind, name: d.name.trim(), country: d.country, date_of_birth: d.dob.trim() }
  // Lens fills an empty company check from the saved company details (talyvor-lens B59.30).
  return { kind, name: '', country: '', company_number: '', directors: [], people_with_significant_control: [] }
}

/** Whether the saved company details can go to the company check: a director, and the person checked among them. */
async function companyProblem(client: BffClient, person: string): Promise<string | null> {
  const saved = await client.companyDetails().catch(() => null)
  if (!saved || !saved.company_name.trim() || !saved.people.some((p) => p.role === 'director' && p.name.trim())) return IDENTITY_ERRORS.companyFirst
  if (person && !saved.people.some((p) => tidy(p.name) === tidy(person))) return IDENTITY_ERRORS.named(person.trim())
  return null
}

function Title({ children }: { children: string }) {
  const { c } = useTheme()
  return (
    <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 17, color: c.ink }}>
      {children}
    </Text>
  )
}

/** B61.118 — the line under the way into the app while the next check waits on the provider or did not pass; null
 *  while nothing has been asked of the provider yet. */
function wayInLine(v: WorkspaceVerification): string | null {
  const next = latest(v, rank(v.level) + 1)
  if (next?.status === 'pending') return IDENTITY_WORDS.openWaiting
  if (next?.status === 'failed' || next?.status === 'returned') return IDENTITY_WORDS.openNotPassed
  return null
}

/**
 * The screen under `head`: the fields the next checks need, the company details for a Business, the Sandbox note and
 * the checks for this account. `done` takes the foot once they pass; with `wayIn` (sign-up's last step, B61.118) the foot
 * also has Open the app while a check waits or after one did not pass, with a note that says so (B57.193: the note, the
 * main button, then Open the app as the quiet one under it).
 */
export function IdentityChecks({ head, done, wayIn = false }: { head: ReactNode; done?: ReactNode; wayIn?: boolean }) {
  const { client } = useSession()
  const { c } = useTheme()
  const { account } = useAccount(client)
  const { v, setV, failed } = useVerification(client)
  const [running, setRunning] = useState<Subject | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  // B61.111 — the country Lens refused (country_not_served) and its sentence, said on the country until another is picked.
  const [refused, setRefused] = useState<{ country: string; sentence: string } | null>(null)
  const [tried, setTried] = useState(false)
  const [d, setD] = useState<Draft>({ email: '', phone: '', name: '', dob: '', country: '' })
  if (failed && !v)
    return (
      <Screen>
        {head}
        <Body muted>Your checks could not be read just now.</Body>
      </Screen>
    )
  if (!v || !account)
    return (
      <Screen>
        {head}
        <Body muted>Reading…</Body>
      </Screen>
    )

  const type = account.account_type
  const level = rank(v.level)
  const need = neededLevel(type)
  const steps = STEPS.filter((s) => s.level <= need)
  const errors = tried ? missing(d, level) : {}
  const set = (k: keyof Draft) => (value: string) => setD({ ...d, [k]: value })
  const personName = level >= 2 ? (latest(v, 2)?.verified_name ?? '') : d.name
  const wayInSaid = wayIn && running === null ? wayInLine(v) : null

  const run = async () => {
    if (running) return
    setTried(true)
    setSaid(null)
    if (Object.keys(missing(d, level)).length > 0) return
    if (type === 'business') {
      const problem = await companyProblem(client, personName)
      if (problem) return setSaid(problem)
    }
    for (const s of steps) {
      if (s.level <= level) continue
      setRunning(s.subject)
      try {
        const ans = await client.verify(bodyFor(s.kind, d))
        setV(ans.verification)
        if (ans.check.status !== 'completed') {
          if (ans.check.status !== 'pending') setSaid(failedText(ans.check))
          break
        }
      } catch (err) {
        const sentence = countryRefusal(err)
        if (sentence) setRefused({ country: d.country, sentence })
        else setSaid(refusedText(err, s.subject))
        break
      }
    }
    setRunning(null)
  }

  const field = (k: keyof Draft, input: ReactNode, hint?: string) => (
    <View key={k} style={{ gap: 6 }}>
      {input}
      {hint && !errors[k] ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: c.ink3 }}>{hint}</Text> : null}
      {errors[k] ? <FieldError>{errors[k]}</FieldError> : null}
    </View>
  )

  const checks = (
    <View testID="identity-checks">
      <Card white>
        <Title>{IDENTITY_WORDS.checks}</Title>
        <View>
          {steps.map((s, i) => {
            const st = stateOf(v, s.level, running === s.subject)
            return (
              <View
                key={s.subject}
                testID={`identity-${s.subject}`}
                style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: c.line }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
                  {level >= s.level ? <Icon name="check" size={16} color={c.success} /> : null}
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{IDENTITY_WORDS[s.subject]}</Text>
                </View>
                <Chip tone={st.tone}>{st.text}</Chip>
              </View>
            )
          })}
        </View>
      </Card>
    </View>
  )

  if (level >= need)
    return (
      <Screen footer={done}>
        {head}
        <View accessibilityRole="summary" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="check" size={18} color={c.success} />
          <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 16, color: c.success }}>{IDENTITY_WORDS.done}</Text>
        </View>
        {checks}
      </Screen>
    )

  return (
    <Screen
      footer={
        <>
          {said ? (
            <View accessibilityLiveRegion="polite">
              <FieldError>{said}</FieldError>
            </View>
          ) : null}
          {wayInSaid ? (
            <View testID="identity-way-in" accessibilityLiveRegion="polite">
              <Note icon={wayInSaid === IDENTITY_WORDS.openWaiting ? 'clock' : 'shield'}>{wayInSaid}</Note>
            </View>
          ) : null}
          <Button primary label={running ? IDENTITY_WORDS.running : IDENTITY_WORDS.run} disabled={running !== null} onPress={() => void run()} />
          {/* B57.193 — drawn as Pocket Live's su6 dock draws a way on past the main button ("Not now"): the ghost one. */}
          {wayInSaid ? <Button variant="ghost" label={IDENTITY_WORDS.open} onPress={() => router.replace('/')} /> : null}
        </>
      }>
      {head}
      <Body muted>{IDENTITY_WORDS.line}</Body>
      {level < 2 ? (
        <View style={{ gap: 14 }}>
          {level < 1
            ? [
                field('email', <Field label={IDENTITY_WORDS.email} value={d.email} onChangeText={set('email')} keyboardType="email-address" autoComplete="email" autoCapitalize="none" autoCorrect={false} />),
                field('phone', <Field label={IDENTITY_WORDS.phone} value={d.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />, IDENTITY_WORDS.phoneHint),
              ]
            : null}
          {field('name', <Field label={IDENTITY_WORDS.legalName} value={d.name} onChangeText={set('name')} maxLength={200} autoComplete="name" autoCapitalize="words" />)}
          {field('dob', <Field label={IDENTITY_WORDS.dateOfBirth} value={d.dob} onChangeText={set('dob')} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" autoComplete="birthdate-full" autoCorrect={false} />)}
          {field('country', <CountryField label={IDENTITY_WORDS.country} value={d.country} onChange={set('country')} error={refused?.country === d.country && !errors.country ? refused.sentence : undefined} />)}
        </View>
      ) : null}
      {type === 'business' ? <CompanyDetailsSection titled /> : null}
      <Note icon="shield">{IDENTITY_WORDS.sandboxNote}</Note>
      {checks}
    </Screen>
  )
}

/** Home's one sentence while the account is not confirmed yet, with the way back to the step. */
export function IdentityGate() {
  const { client } = useSession()
  const { account } = useAccount(client)
  const [v, setV] = useState<WorkspaceVerification | null>(null)
  useEffect(() => {
    let live = true
    client.verification().then((got) => live && setV(got), () => undefined)
    return () => {
      live = false
    }
  }, [client])
  if (!account || !v || rank(v.level) < 0 || rank(v.level) >= neededLevel(account.account_type)) return null
  return (
    <View testID="identity-gate">
      <Card white>
        <Body>{IDENTITY_WORDS.gate}</Body>
        <Button primary label={IDENTITY_WORDS.finish} onPress={() => router.push('/settings/verification')} />
      </Card>
    </View>
  )
}
