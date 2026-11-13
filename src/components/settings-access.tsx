import { BffError, refusalText, rulesInWords, type ApprovalKey, type MemberRole } from '@talyvor/bff-client'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { thisPhoneDevice, turnOffPhoneApprovals } from '@/keys'
import { Choices } from './account-requests'
import { Icon } from './icon'
import { BottomSheet } from './pay-sheet'
import { PhoneKeyCard } from './phone-key-card'
import { Body, Button, Card, Eyebrow, Field, Headline, Row, useLoad } from './ui'
import { useSession } from '../session'
import { fonts, useTheme } from '../theme'

// B59.39 — Settings' security keys, team and roles, and limits (launch pack 1.9), in the web's words: keys as the web's
// Approvals and devices card lists and removes them (AgentBank.tsx FaceID, RemoveKey.tsx), the team as Members.tsx adds
// to it, and each agent's limits as its own screen says them. The second approver waits for its rule in Lens (B28.315,
// then B59.50).

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
          <Body muted>{keysLine(list)}</Body>
          {list.map((k) => (
            <Row
              key={`${k.kind}-${k.id}`}
              title={k.name || (k.kind === 'phone' ? 'Phone key' : 'Passkey')}
              sub={keyFacts(k)}
              right={list.length === 1 ? undefined : <Button small label="Remove" accessibilityLabel={`Remove ${k.name}`} onPress={() => ask(k)} />}
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
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  const roster = [...(data ?? [])].sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name))
  const add = async () => {
    const sent = email.trim()
    setBusy(true)
    setSaid(null)
    try {
      const m = await client.addMember(sent, role)
      setEmail('')
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
          <Row key={m.id} first={i === 0} title={m.name || m.email} sub={`${m.email} · ${ROLE_LABEL[m.role] ?? m.role}`} />
        ))}
      </Card>
      <Card>
        <Body muted>Add someone by the email they sign in with. Each person takes one of your plan’s seats.</Body>
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="name@company.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!busy} />
        <Choices label="Role" options={[['member', 'Member'], ['owner', 'Owner']] as const} value={role} onChange={setRole} />
        <Button primary label={busy ? 'Adding…' : 'Add member'} disabled={!email.trim() || busy} onPress={() => void add()} />
        {said ? <Body style={said.ok ? undefined : { color: c.critical }}>{said.text}</Body> : null}
      </Card>
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
    return agents.map((a, i) => ({ id: a.id, name: a.name, words: rulesInWords(rules[i], peg).join(' ') }))
  }, [client])
  const { data, error } = useLoad(load)
  return (
    <View testID="limits" style={{ gap: 12 }}>
      <Eyebrow>Limits</Eyebrow>
      {error ? <Body muted>{refusalText(error)}</Body> : null}
      {data && !data.length ? <Body muted>No agents yet.</Body> : null}
      {data && data.length > 0 ? (
        <Card>
          {data.map((a, i) => (
            <Row
              key={a.id}
              first={i === 0}
              title={a.name}
              sub={a.words}
              right={<Icon name="chev" size={16} color={c.ink3} />}
              onPress={() => router.push({ pathname: '/agents/[id]', params: { id: a.id } })}
            />
          ))}
        </Card>
      ) : null}
    </View>
  )
}
