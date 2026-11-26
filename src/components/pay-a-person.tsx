import { BffError, refusalText, type BffClient } from '@talyvor/bff-client'
import { router, useFocusEffect } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useCallback, useState } from 'react'
import { Text, TextInput, View } from 'react-native'

import { useSession } from '../session'
import { fonts, useTheme } from '../theme'
import { Icon } from './icon'
import { Press } from './press'
import { Body, Button, Card, Eyebrow, Row } from './ui'

// B61.34 — Pay, to a person on Talyvor, on the phone: the web's B61.33 (talyvor-suite PayPerson.tsx) with its words, as
// Pocket Live's phone `pay` draws it. One field takes their Talyvor name, phone number or email; Lens answers the
// person's shown name and nothing else (BFF B61.33, Lens B61.32), or its one answer for nobody found. Pay opens
// /pay-person with what was typed, never the name. The people paid before are chips: Lens keeps only a hash of what the sender typed, so the phone keeps
// what was typed and the shown name, by workspace, in its keychain.

/** Said when Lens finds nobody; Lens's own words, the same whatever the reason (economy.PersonNotFoundWords). */
export const NOBODY_FOUND = 'Nobody found. Check the name or number, or ask them to turn on being found in Settings.'

/** A person as the phone remembers them: what was typed, and the shown name Lens answered. */
export interface PaidPerson {
  to: string
  shown_name: string
}

const PAID_PREFIX = 'talyvor.people-paid.'
const PAID_KEPT = 8

const paidKey = (workspace: string) => PAID_PREFIX + workspace.replace(/[^\w.-]/g, '_')

async function readPaid(workspace: string): Promise<PaidPerson[]> {
  try {
    const parsed: unknown = JSON.parse((await SecureStore.getItemAsync(paidKey(workspace))) ?? '[]')
    return Array.isArray(parsed) ? (parsed as PaidPerson[]).filter((p) => typeof p?.to === 'string' && typeof p?.shown_name === 'string') : []
  } catch {
    return []
  }
}

/** The people paid before from the signed-in workspace, newest first; nothing when it cannot be read. */
export async function paidPeople(client: BffClient): Promise<PaidPerson[]> {
  const me = await client.me().catch(() => null)
  return me ? readPaid(me.workspace_id) : []
}

/** Keeps `person` first among the people paid before; a phone that keeps nothing shows no chips, and the payment stands. */
export async function rememberPaid(client: BffClient, person: PaidPerson): Promise<void> {
  try {
    const { workspace_id } = await client.me()
    const same = (p: PaidPerson) => p.to.toLowerCase() === person.to.toLowerCase()
    const next = [person, ...(await readPaid(workspace_id)).filter((p) => !same(p))].slice(0, PAID_KEPT)
    await SecureStore.setItemAsync(paidKey(workspace_id), JSON.stringify(next))
  } catch {
    // nothing kept: no chip next time
  }
}

// The shown name Lens answered for what was typed, kept in memory for /pay-person: the screen never takes a name from its
// link, which anyone could write, so it names the person only as Lens did, here or by finding them again.
const answered = new Map<string, string>()

/** The shown name Lens gave for `to` in this run of the app, or ''. */
export const foundName = (to: string) => answered.get(to) ?? ''

/** "Dana R." → "DR". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** The person's initials in a round, as the reference draws a person. */
export function Initials({ name, size = 40 }: { name: string; size?: number }) {
  const { c } = useTheme()
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cloud2 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: size * 0.36, color: c.ink }}>{initials(name)}</Text>
    </View>
  )
}

/** The "To a person" card, first on Pay: the field, what it found, and the chips of people paid before. B57.183 — drawn as
 * Pocket Live's phone `pay`: the field is its search pill, with its words as the placeholder, and the person found is one
 * row to press (their initials, the shown name, On Talyvor and the chevron), which opens Pay a person. */
export function PayToAPerson() {
  const { client } = useSession()
  const { c } = useTheme()
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<PaidPerson | null>(null)
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [paid, setPaid] = useState<PaidPerson[]>([])
  // Read again each time Pay shows, so a person just paid is a chip when the person comes back.
  useFocusEffect(
    useCallback(() => {
      let live = true
      void paidPeople(client).then((p) => live && setPaid(p))
      return () => {
        live = false
      }
    }, [client]),
  )
  const look = async (to: string) => {
    setTyped(to)
    setFound(null)
    setSaid('')
    const q = to.trim()
    if (!q) return
    setBusy(true)
    try {
      const f = await client.findPerson(q)
      answered.set(q, f.shown_name)
      setFound({ to: q, shown_name: f.shown_name })
    } catch (err) {
      // Lens's words for nobody found, as it said them; the same words if it said none.
      setSaid(err instanceof BffError && err.status === 404 ? err.sentence || NOBODY_FOUND : refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  const pay = (p: PaidPerson) => {
    router.push({ pathname: '/pay-person', params: { to: p.to } })
    setFound(null)
    setTyped('')
  }
  return (
    <Card white>
      <View testID="pay-a-person" style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 20, color: c.ink }}>
          To a person
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 16, borderRadius: 999, backgroundColor: c.cloud, boxShadow: `inset 0 0 0 1px ${c.frostLine}` }}>
          <Icon name="search" size={18} color={c.ink2} />
          <TextInput
            accessibilityLabel="Name, phone number or email"
            placeholder="Name, phone number or email"
            placeholderTextColor={c.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="search"
            value={typed}
            onChangeText={(v) => {
              setTyped(v)
              setFound(null)
              setSaid('')
            }}
            onSubmitEditing={() => !busy && void look(typed)}
            style={{ flex: 1, height: 48, fontFamily: fonts.uiMedium, fontSize: 15, color: c.ink }}
          />
        </View>
        {found ? (
          <View testID="pay-a-person-found">
            <Press kind="row" accessibilityRole="button" accessibilityLabel={`Pay ${found.shown_name}`} onPress={() => pay(found)}>
              <Row first left={<Initials name={found.shown_name} size={42} />} title={found.shown_name} sub="On Talyvor" right={<Icon name="chev" size={16} color={c.ink3} />} />
            </Press>
          </View>
        ) : (
          <Button
            primary
            label={busy ? 'Finding…' : 'Find'}
            disabled={busy || typed.trim() === ''}
            hint={busy ? 'Finding…' : 'Type a name, phone number or email first.'}
            onPress={() => void look(typed)}
          />
        )}
        {said ? (
          <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
            <Icon name="x" size={16} color={c.ink} />
            <View style={{ flex: 1 }}>
              <Body>{said}</Body>
            </View>
          </View>
        ) : null}
        {paid.length > 0 ? (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 4 }}>
            <Eyebrow>Paid before</Eyebrow>
            <View testID="pay-a-person-paid" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {paid.map((p) => (
                <Button key={p.to} small variant="secondary" label={p.shown_name} accessibilityLabel={`Pay ${p.shown_name} again`} onPress={() => void look(p.to)} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  )
}
