import { BffError, type CompanyDetails, type ControlRole } from '@talyvor/bff-client'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { useAccount } from '@/account'
import { CardTitle, Choices, SaidLine, type Said } from '@/components/account-requests'
import { CountryField, FieldError } from '@/components/country-field'
import { Body, Button, Card, Field, useLoad } from '@/components/ui'
import { COMPANY_WORDS, ROLE_LABEL, shareBps, shareText } from '@/company-words'
import { useSession } from '@/session'
import { PROFILE_ERRORS, PROFILE_LABELS } from '@/signup-words'
import { fonts, useTheme } from '@/theme'

// company-details.tsx — B59.32: a Business workspace's company name, registration number and country, and the people
// with control, each with a name, a role and a share (SPEC 6 (4)), as the web's B59.31 has them (talyvor-suite
// apps/web/src/areas/lens/CompanyDetails.tsx at cd14b62). In Settings (/settings/company) and at sign-up's step 3. They
// go to the partner's identity check later; no document is asked for. A Personal account never sees it and asks nothing.
// B57.152 draws it as the web's B57.145 does (suite bbde88c): the company and the people with control in a card each.

/** One person as typed: the share is the words in the box, in percent. */
interface PersonDraft {
  /** The row's own key on this screen: a person has no id until Lens keeps them. */
  key: number
  name: string
  role: ControlRole
  share: string
}

interface Draft {
  companyName: string
  registrationNumber: string
  country: string
  people: PersonDraft[]
}

const draftOf = (d: CompanyDetails): Draft => ({
  companyName: d.company_name,
  registrationNumber: d.registration_number,
  country: d.country,
  people: d.people.map((p, i) => ({ key: i, name: p.name, role: p.role, share: p.share_bps ? shareText(p.share_bps) : '' })),
})

type Errors = Partial<Record<'companyName' | 'registrationNumber' | 'country' | 'shares', string>> & { people?: Record<number, { name?: string; share?: string }> }

/** What the draft still lacks, keyed by field; empty when it can be sent. */
function check(d: Draft): Errors {
  const out: Errors = {}
  if (!d.companyName.trim()) out.companyName = PROFILE_ERRORS.companyName
  if (!d.registrationNumber.trim()) out.registrationNumber = PROFILE_ERRORS.registrationNumber
  if (!d.country) out.country = PROFILE_ERRORS.country
  let total = 0
  d.people.forEach((p, i) => {
    const bps = shareBps(p.share)
    const e: { name?: string; share?: string } = {}
    if (!p.name.trim()) e.name = COMPANY_WORDS.personName
    if (bps === null) e.share = COMPANY_WORDS.shareRange
    else total += bps
    if (e.name || e.share) out.people = { ...out.people, [i]: e }
  })
  if (total > 10000) out.shares = COMPANY_WORDS.sharesTotal
  return out
}

/** The body the BFF is sent: names tidied, shares in hundredths of a percent. */
function bodyOf(d: Draft): CompanyDetails {
  return {
    company_name: d.companyName.trim(),
    registration_number: d.registrationNumber.trim(),
    country: d.country,
    people: d.people.map((p) => ({ name: p.name.trim(), role: p.role, share_bps: shareBps(p.share) ?? 0 })),
  }
}

/** A row's heading until the person has a name. */
const personLabel = (i: number) => `Person ${i + 1}`

function refusal(err: unknown): string {
  if (err instanceof BffError && err.status === 401) return 'Nothing changed. Sign in again.'
  if (err instanceof BffError && err.status === 400 && err.sentence) {
    const s = err.sentence.replace(/^economy: invalid business details: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return COMPANY_WORDS.failed
}

/** The form itself, filled from what was saved. */
function CompanyForm({ saved }: { saved: CompanyDetails }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved))
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [said, setSaid] = useState<Said>(null)
  const errors = tried ? check(draft) : {}
  const set = (field: 'companyName' | 'registrationNumber' | 'country') => (v: string) => setDraft({ ...draft, [field]: v })
  const setPerson = (i: number, p: Partial<PersonDraft>) => setDraft({ ...draft, people: draft.people.map((q, j) => (j === i ? { ...q, ...p } : q)) })

  const save = async () => {
    setTried(true)
    if (saving || Object.keys(check(draft)).length > 0) return
    setSaving(true)
    setSaid(null)
    try {
      setDraft(draftOf(await client.saveCompanyDetails(bodyOf(draft))))
      setSaid({ title: COMPANY_WORDS.saved, line: COMPANY_WORDS.line })
    } catch (err) {
      setSaid({ refused: refusal(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={{ gap: 14 }}>
      {/* B57.152 — Pocket's settings form, as the web's B57.145 draws it: the company in its own titled white card. */}
      <View testID="company">
        <Card white>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 17, color: c.ink }}>
            {COMPANY_WORDS.company}
          </Text>
          <View style={{ gap: 6 }}>
            <Field label={PROFILE_LABELS.companyName} value={draft.companyName} onChangeText={set('companyName')} maxLength={200} autoComplete="organization" autoCapitalize="words" />
            {errors.companyName ? <FieldError>{errors.companyName}</FieldError> : null}
          </View>
          <View style={{ gap: 6 }}>
            <Field label={PROFILE_LABELS.registrationNumber} value={draft.registrationNumber} onChangeText={set('registrationNumber')} maxLength={64} autoComplete="off" autoCapitalize="characters" />
            {errors.registrationNumber ? <FieldError>{errors.registrationNumber}</FieldError> : null}
          </View>
          <View style={{ gap: 6 }}>
            <CountryField value={draft.country} onChange={set('country')} />
            {errors.country ? <FieldError>{errors.country}</FieldError> : null}
          </View>
        </Card>
      </View>

      {/* B57.152 — the people as a list (the web's w-members): each row headed by the person, their role and share. */}
      <View testID="people">
        <Card white>
          <View style={{ gap: 2 }}>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 17, color: c.ink }}>
              {COMPANY_WORDS.people}
            </Text>
            <Body muted>{COMPANY_WORDS.peopleLine}</Body>
          </View>
          {draft.people.length > 0 ? (
            <View>
              {draft.people.map((p, i) => {
                const e = errors.people?.[i] ?? {}
                const name = p.name.trim()
                const bps = shareBps(p.share)
                return (
                  <View key={p.key} testID={`person-${i}`} style={[{ gap: 12, paddingVertical: 14 }, i === 0 ? { paddingTop: 4 } : { borderTopWidth: 1, borderTopColor: c.line }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.cloud2, alignItems: 'center', justifyContent: 'center' }}>
                        <Text
                          importantForAccessibility="no"
                          accessibilityElementsHidden
                          style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink, fontVariant: name ? undefined : ['tabular-nums'] }}>
                          {name ? name.charAt(0).toUpperCase() : i + 1}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text accessibilityRole="header" numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>
                          {name || personLabel(i)}
                        </Text>
                        <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3, fontVariant: ['tabular-nums'] }}>
                          {bps ? `${ROLE_LABEL[p.role]} · ${shareText(bps)}%` : ROLE_LABEL[p.role]}
                        </Text>
                      </View>
                      <Button
                        small
                        variant="outline"
                        label={COMPANY_WORDS.remove}
                        accessibilityLabel={`${COMPANY_WORDS.remove} ${name || personLabel(i).toLowerCase()}`}
                        onPress={() => setDraft({ ...draft, people: draft.people.filter((_, j) => j !== i) })}
                      />
                    </View>
                    <View style={{ gap: 6 }}>
                      <Field label={COMPANY_WORDS.name} value={p.name} onChangeText={(v) => setPerson(i, { name: v })} maxLength={200} autoComplete="off" autoCapitalize="words" />
                      {e.name ? <FieldError>{e.name}</FieldError> : null}
                    </View>
                    <Choices label={COMPANY_WORDS.role} options={(Object.keys(ROLE_LABEL) as ControlRole[]).map((r) => [r, ROLE_LABEL[r]] as [ControlRole, string])} value={p.role} onChange={(r) => setPerson(i, { role: r })} />
                    <View style={{ gap: 6 }}>
                      <Field label={COMPANY_WORDS.share} value={p.share} onChangeText={(v) => setPerson(i, { share: v })} keyboardType="decimal-pad" placeholder="%" />
                      {e.share ? <FieldError>{e.share}</FieldError> : null}
                    </View>
                  </View>
                )
              })}
            </View>
          ) : null}
          {errors.shares ? <FieldError>{errors.shares}</FieldError> : null}
          <Button
            variant="secondary"
            label={COMPANY_WORDS.add}
            onPress={() => setDraft({ ...draft, people: [...draft.people, { key: Math.max(-1, ...draft.people.map((q) => q.key)) + 1, name: '', role: 'director', share: '' }] })}
          />
        </Card>
      </View>
      <SaidLine said={said} />
      <Button primary label={saving ? COMPANY_WORDS.saving : COMPANY_WORDS.save} disabled={saving} onPress={() => void save()} />
    </View>
  )
}

/** Reads the saved details and draws the line and the form; only ever drawn for a Business. */
function CompanyCard({ titled }: { titled: boolean }) {
  const { client } = useSession()
  const details = useLoad(useCallback(() => client.companyDetails(), [client]))
  if (details.loading && !details.data) return null
  if (details.data === null && !details.error) return null
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        {titled ? <CardTitle>{COMPANY_WORDS.title}</CardTitle> : null}
        <Body muted>{COMPANY_WORDS.line}</Body>
      </View>
      {details.data ? <CompanyForm saved={details.data} /> : <Body muted>{COMPANY_WORDS.readFailed}</Body>}
    </View>
  )
}

/**
 * The company details for a Business account; nothing at all for a Personal one, or while either is read. `titled` gives
 * them their own heading, for sign-up; in Settings the screen's headline already names them, and the line sits under it.
 */
export function CompanyDetailsSection({ titled = false }: { titled?: boolean }) {
  const { client } = useSession()
  const { account } = useAccount(client)
  return account?.account_type === 'business' ? <CompanyCard titled={titled} /> : null
}
