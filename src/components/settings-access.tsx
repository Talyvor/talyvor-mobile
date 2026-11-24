import { amountMinor, BffError, formatMinor, refusalText, rulesInWords, type ApprovalKey, type GivenRole, type MemberRole, type SecondApproverLine } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useCallback, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'

import { useAccount } from '@/account'
import { biometricName, keyGone, keyGoneText, setSecondApproverSigned, thisPhoneDevice, turnOffPhoneApprovals } from '@/keys'
import { Choices } from './account-requests'
import { Face } from './face'
import { Icon } from './icon'
import { BottomSheet } from './pay-sheet'
import { PhoneKeyCard } from './phone-key-card'
import { Body, Button, Card, Chip, Eyebrow, Field, Headline, Row, useLoad } from './ui'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'

// B59.39 — Settings' security keys, team and roles, and limits (launch pack 1.9), in the web's words: keys as the web's
// Approvals and devices card lists and removes them (AgentBank.tsx FaceID, RemoveKey.tsx), the team as Members.tsx adds
// to it, and each agent's limits as its own screen says them. The second approver waits for its rule in Lens (B28.315,
// then B59.50).
// B57.154 — drawn in Pocket as w-security, w-members and p-approvals draw the same things: the keys under the shield's
// "Approvals are signed", each key on its kind's tile with a cloud Remove; each member on their initial with their role
// as a chip, and Add member opening the bottom sheet; each agent's limits beside its face.
// B59.50 — the second approver under Team and roles, in the web's words (suite B28.40, TeamRoles.tsx SecondApprover): an
// Approver or Admin who has signed in, and the amount above which a payment needs two people's approvals, one of them
// theirs (Lens B28.315). Setting or removing it is signed with this phone's key over Lens's challenge for exactly that line.

/** A row's 36 tile, as w-security draws a key's kind and w-members a person's initial. */
function Tile({ children, round, testID }: { children: ReactNode; round?: boolean; testID?: string }) {
  const { c } = useTheme()
  return (
    <View testID={testID} style={{ width: 36, height: 36, borderRadius: round ? 18 : 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud2 }}>
      {children}
    </View>
  )
}

/** B55.16 — what the owner is told on the workspace's last key, and when Lens refuses one as the last (409). */
export const LAST_KEY = 'It is your last key. With none, nobody could approve, so add another first.'

const isLastKeyRefusal = (err: unknown) => err instanceof BffError && err.status === 409 && /last key/i.test(err.sentence)

/** "today at 09:00", "yesterday" or "14 Oct", as the web's formatDecided. */
function decided(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const ago = Math.round((day(now) - day(d)) / 86_400_000)
  if (ago === 0) return `today at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  if (ago === 1) return 'yesterday'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "Passkey · added 14 Oct · last used yesterday", or "Phone key · …". */
const keyFacts = (k: ApprovalKey) =>
  [k.kind === 'phone' ? 'Phone key' : 'Passkey', `added ${decided(k.created_at)}`, k.last_used_at ? `last used ${decided(k.last_used_at)}` : 'never used'].join(' · ')

/** "2 passkeys and your phone’s key are registered. You approve with one of them; nothing is approved without one." */
function keysLine(keys: ApprovalKey[]): string {
  const phones = keys.filter((k) => k.kind === 'phone').length
  const passkeys = keys.length - phones
  const what = [passkeys === 0 ? '' : `${passkeys} passkey${passkeys === 1 ? '' : 's'}`, phones === 0 ? '' : phones === 1 ? 'your phone’s key' : `${phones} phone keys`]
    .filter((x) => x !== '')
    .join(' and ')
  const head = `${what.charAt(0).toUpperCase()}${what.slice(1)} ${keys.length === 1 ? 'is' : 'are'} registered.`
  return keys.length === 1 ? `${head} You approve with it; nothing is approved without it.` : `${head} You approve with one of them; nothing is approved without one.`
}

/** Every passkey and phone key by name, any but the last removed after asking, and this phone's own key to add or turn off.
 * Lens lets only the owner or an admin read the list; anyone else keeps this phone's card without it. */
export function SecurityKeys() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(() => client.approvalKeys(), [client])
  const { data: keys, reload } = useLoad(load)
  const [asking, setAsking] = useState<ApprovalKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [said, setSaid] = useState('')
  // Removing this phone's own key leaves its card stale, so the card is drawn again.
  const [round, setRound] = useState(0)
  const ask = (k: ApprovalKey | null) => {
    setError(null)
    setAsking(k)
  }
  const remove = async (k: ApprovalKey) => {
    setBusy(true)
    setError(null)
    try {
      // Removing needs no signature: stopping a key is instant, and Lens refuses the last one.
      if (k.kind === 'passkey') await client.removePasskey(k.id)
      else if (k.id === (await thisPhoneDevice())) await turnOffPhoneApprovals(client)
      else await client.revokeDevice(k.id)
      setAsking(null)
      setSaid(`Removed: ${k.name}. It can no longer approve anything.`)
      setRound((r) => r + 1)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
      reload()
    }
  }
  const lastKey = isLastKeyRefusal(error)
  const list = keys ?? []
  return (
    <View testID="security-keys" style={{ gap: 12 }}>
      <Eyebrow>Security keys</Eyebrow>
      {list.length > 0 ? (
        <Card>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.success50 }}>
              <Icon name="shield" size={22} color={c.success} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 16.5, color: c.ink }}>Approvals are signed</Text>
              <Body muted>{keysLine(list)}</Body>
            </View>
          </View>
          {list.map((k) => (
            <Row
              key={`${k.kind}-${k.id}`}
              left={
                <Tile testID={`key-tile-${k.kind}-${k.id}`}>
                  <Icon name={k.kind === 'phone' ? 'phone' : 'key'} size={18} color={c.ink} />
                </Tile>
              }
              title={k.name || (k.kind === 'phone' ? 'Phone key' : 'Passkey')}
              sub={keyFacts(k)}
              right={list.length === 1 ? undefined : <Button small variant="secondary" label="Remove" accessibilityLabel={`Remove ${k.name}`} onPress={() => ask(k)} />}
            />
          ))}
          {list.length === 1 ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: c.ink3 }}>{LAST_KEY}</Text> : null}
        </Card>
      ) : null}
      {said ? <Body muted>{said}</Body> : null}
      <PhoneKeyCard key={round} />
      <BottomSheet visible={asking !== null} onClose={() => !busy && ask(null)}>
        <Headline>{`Remove “${asking?.name ?? ''}”?`}</Headline>
        <Body muted>{lastKey ? LAST_KEY : 'It can no longer approve anything.'}</Body>
        {error && !lastKey ? <Body style={{ color: c.critical }}>{refusalText(error)}</Body> : null}
        {lastKey ? null : <Button variant="danger" label={busy ? 'Removing…' : 'Remove it'} disabled={busy} onPress={() => asking && void remove(asking)} />}
        <Button variant="secondary" label="Keep it" disabled={busy} onPress={() => ask(null)} />
      </BottomSheet>
    </View>
  )
}

const ROLE_LABEL: Record<MemberRole, string> = { owner: 'Owner', member: 'Member' }

/** What the screen says when an add is refused, as the web's Members.tsx says it. A 402 is Lens's own sentence. */
function addRefusal(err: unknown, email: string): string {
  if (err instanceof BffError) {
    if (err.status === 401) return 'Sign in again to add a member.'
    if (err.status === 402 && err.sentence) return err.sentence
    if (err.code === 'MEMBER_EXISTS') return `${email} is already a member of this workspace.`
    if (err.code === 'OWNER_REQUIRED') return 'Only an owner of this workspace can add members.'
    if (err.code === 'SEATS_UNCHECKED') return 'Your plan’s seats couldn’t be checked just now, so nobody was added. Try again shortly.'
  }
  return 'Nobody was added. You can try again.'
}

/** A Business's members and their roles, owners first, and adding one by email as a member or an owner. Drawn only for a
 * Business: Settings leaves it out of a Personal account altogether (launch pack 3.4). */
export function TeamAndRoles() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(() => client.members(), [client])
  const { data, error, reload } = useLoad(load)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('member')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  const roster = [...(data ?? [])].sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name))
  const add = async () => {
    const sent = email.trim()
    setBusy(true)
    setSaid(null)
    try {
      const m = await client.addMember(sent, role)
      setEmail('')
      setAdding(false)
      setSaid({ ok: true, text: `${m.email} was added as ${m.role === 'owner' ? 'an owner' : 'a member'}.` })
      reload()
    } catch (err) {
      setSaid({ ok: false, text: addRefusal(err, sent) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <View testID="team-and-roles" style={{ gap: 12 }}>
      <Eyebrow>Team and roles</Eyebrow>
      <Card>
        {error ? <Body muted>The roster could not be read.</Body> : null}
        {roster.map((m, i) => (
          <Row
            key={m.id}
            first={i === 0}
            left={
              <Tile round testID={`member-${m.id}-initial`}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{(m.name || m.email).slice(0, 1).toUpperCase()}</Text>
              </Tile>
            }
            title={m.name || m.email}
            sub={m.email}
            right={
              <View testID={`member-${m.id}-role`}>
                <Chip>{ROLE_LABEL[m.role] ?? m.role}</Chip>
              </View>
            }
          />
        ))}
      </Card>
      {said?.ok ? <Body muted>{said.text}</Body> : null}
      <Button
        primary
        label="Add member"
        onPress={() => {
          setSaid(null)
          setAdding(true)
        }}
      />
      <SecondApprover />
      <BottomSheet visible={adding} onClose={() => !busy && setAdding(false)}>
        <Headline>Add a member</Headline>
        <Body muted>Add someone by the email they sign in with. Each person takes one of your plan’s seats.</Body>
        <Card>
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="name@company.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!busy} />
          <Choices label="Role" options={[['member', 'Member'], ['owner', 'Owner']] as const} value={role} onChange={setRole} />
        </Card>
        {said && !said.ok ? <Body style={{ color: c.critical }}>{said.text}</Body> : null}
        <Button testID="add-member-send" primary label={busy ? 'Adding…' : 'Add member'} disabled={!email.trim() || busy} onPress={() => void add()} />
      </BottomSheet>
    </View>
  )
}

/** The roles that may approve (talyvor-lens approvalRoles): only they can be a second approver. */
const APPROVING_ROLES: readonly GivenRole['role'][] = ['approver', 'admin']

const GIVEN_ROLE_NAME: Record<GivenRole['role'], string> = { viewer: 'Viewer', finance: 'Finance', approver: 'Approver', admin: 'Admin' }

/** What went wrong saving the second approver, in words: the web's, and the phone's own for its key. */
function lineRefusal(err: unknown): string {
  if (keyGone(err)) return keyGoneText
  if (err instanceof BffError && err.status === 403)
    return `It needs your signature. Turn on approving with ${biometricName} in Approvals, or set it on the web.`
  if (err instanceof BffError && (err.status === 401 || (err.status < 500 && err.sentence))) return refusalText(err)
  if (err instanceof BffError) return 'The second approver wasn’t saved. Try again.'
  return 'Cancelled. Nothing changed.'
}

/** B59.50 — a Business owner's second approver: who, and above which amount a payment needs two approvals. */
function SecondApprover() {
  const { client } = useSession()
  const { c } = useTheme()
  const { shows } = useAccount(client)
  const load = useCallback(async () => {
    const [line, team] = await Promise.all([client.secondApprover(), client.givenRoles()])
    return { line, team }
  }, [client])
  const { data, error, reload } = useLoad(load)
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState('')
  const [said, setSaid] = useState<{ title: string; line: string } | null>(null)
  const currencies = shows ? [...(shows.bankTransfers ? ['GBP', 'EUR', 'USD'] : []), ...(shows.onChain ? ['USDC'] : [])] : []
  const team = data?.team ?? []
  const people = team.filter((r) => APPROVING_ROLES.includes(r.role) && !!r.user_id)
  const pickedWho = who || people[0]?.user_id || ''
  const pickedCurrency = currency || data?.line.currency || currencies[0] || 'GBP'
  const named = (id: string) => team.find((r) => r.user_id === id)?.email ?? 'someone no longer in your team'
  const now = data && data.line.user_id && data.line.above_minor > 0 ? data.line : null
  const save = async (l: SecondApproverLine) => {
    setBusy(true)
    setSaid(null)
    setWrong('')
    try {
      await setSecondApproverSigned(client, l, l.user_id ? 'Set your second approver' : 'Remove your second approver')
      setAmount('')
      setSaid(l.user_id ? { title: 'Second approver saved', line: `Above ${formatMinor(l.above_minor, l.currency)}, a payment needs two approvals.` } : { title: 'Second approver removed', line: 'One approval is enough again.' })
      reload()
    } catch (err) {
      setWrong(lineRefusal(err))
    } finally {
      setBusy(false)
    }
  }
  const submit = () => {
    const minor = amountMinor(amount, pickedCurrency)
    if (minor === null) return setWrong('Enter an amount above 0.')
    void save({ user_id: pickedWho, above_minor: minor, currency: pickedCurrency })
  }
  return (
    <View testID="second-approver" style={{ gap: 12 }}>
      <Card>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 16.5, color: c.ink }}>Second approver</Text>
          <Body muted>Above an amount you choose, a payment needs two people to approve it, and one of them is your second approver.</Body>
        </View>
        {error ? (
          <Body muted>{refusalText(error)}</Body>
        ) : !data ? (
          <Body muted>Reading…</Body>
        ) : now ? (
          <View testID="second-approver-now">
            <Row
              left={
                <Tile round>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{named(now.user_id).slice(0, 1).toUpperCase()}</Text>
                </Tile>
              }
              title={named(now.user_id)}
              sub={`Above ${formatMinor(now.above_minor, now.currency)}`}
              right={<Button small variant="secondary" label="Remove" disabled={busy} onPress={() => void save({ user_id: '', above_minor: 0, currency: '' })} />}
            />
          </View>
        ) : (
          <Body muted>No second approver: one approval is enough.</Body>
        )}
        {data && people.length > 0 && currencies.length > 0 ? (
          <View style={{ gap: 12 }}>
            <Choices label="Who" options={people.map((r) => [r.user_id ?? '', `${r.email} · ${GIVEN_ROLE_NAME[r.role] ?? r.role}`] as [string, string])} value={pickedWho} onChange={setWho} />
            <Field label="Above" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoCorrect={false} editable={!busy} />
            <Choices label="Currency" options={currencies.map((x) => [x, x] as [string, string])} value={pickedCurrency} onChange={setCurrency} />
            <Button testID="second-approver-save" primary label={busy ? 'Saving…' : 'Save'} disabled={busy} onPress={submit} />
          </View>
        ) : data ? (
          <Body muted>Give someone the Approver or Admin role. Once they have signed in, you can pick them here.</Body>
        ) : null}
        {wrong ? <Body style={{ color: c.critical }}>{wrong}</Body> : null}
      </Card>
      {said ? (
        <View testID="second-approver-said" style={{ gap: 2 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: c.ink }}>{said.title}</Text>
          <Body muted>{said.line}</Body>
        </View>
      ) : null}
    </View>
  )
}

/** Each agent's limits from its rules, in the words its own screen uses; a press opens the agent, where they change. */
export function Limits() {
  const { client } = useSession()
  const { c } = useTheme()
  const load = useCallback(async () => {
    const [book, peg] = await Promise.all([client.book(), client.peg()])
    const agents = (book.agents ?? []).filter((a) => !a.archived_at)
    const rules = await Promise.all(agents.map((a) => client.rules(a.id)))
    return agents.map((a, i) => ({ agent: a, words: rulesInWords(rules[i], peg).join(' ') }))
  }, [client])
  const { data, error } = useLoad(load)
  return (
    <View testID="limits" style={{ gap: 12 }}>
      <Eyebrow>Limits</Eyebrow>
      {error ? <Body muted>{refusalText(error)}</Body> : null}
      {data && !data.length ? <Body muted>No agents yet.</Body> : null}
      {data && data.length > 0 ? (
        <Card>
          {data.map(({ agent: a, words }, i) => (
            <Row
              key={a.id}
              first={i === 0}
              left={<Face agent={a} size={36} />}
              title={a.name}
              sub={words}
              right={<Icon name="chev" size={16} color={c.ink3} />}
              onPress={() => router.push({ pathname: '/agents/[id]', params: { id: a.id } })}
            />
          ))}
        </Card>
      ) : null}
    </View>
  )
}
