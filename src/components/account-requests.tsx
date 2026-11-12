import { BalancesHeldError, BffError, formatMinor, refusalText, type AccountRequest, type RequestKind } from '@talyvor/bff-client'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useCallback, useState, type ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { Body, Button, Card, Chip, useLoad } from '@/components/ui'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B59.29 — the phone's Help and complaints, Close this account and Your data, with the web's words (talyvor-suite B59.28,
// apps/web/src/areas/lens/HelpAndAccount.tsx at 4fb65ba). Each sends a request a person at Talyvor answers (Lens B59.27)
// and lists what was sent with its state and, for a complaint, its reference. Closing the account is refused while any
// balance is not empty, and the refusal names each one. A finished data export goes to the share sheet. No screen
// promises when an answer comes.

const KIND_TITLE: Record<RequestKind, string> = {
  support: 'Question or problem',
  complaint: 'Complaint',
  account_closure: 'Close this account',
  data_export: 'A copy of your data',
  data_deletion: 'Delete your data',
}

const STATE_CHIP: Record<AccountRequest['state'], ReactNode> = {
  received: <Chip tone="wait">Received</Chip>,
  in_progress: (
    <Chip tone="wait" dot>
      In progress
    </Chip>
  ),
  done: <Chip tone="good">Done</Chip>,
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** A refusal as one sentence: what the account still holds, or Lens's own words where it gave them. */
export function refusalLine(err: unknown): string {
  if (err instanceof BffError && err.status === 401) return 'Nothing was sent. Sign in again.'
  if (err instanceof BalancesHeldError) {
    const held = Object.keys(err.balances)
      .sort()
      .map((c) => formatMinor(err.balances[c], c))
      .join(', ')
    return `This account still holds ${held}. Move the money out, then ask again.`
  }
  if (err instanceof BffError && err.status < 500 && err.sentence) {
    const s = err.sentence.replace(/^support: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing was sent. You can try again.'
}

/** A card's title, in the display face. */
export function CardTitle({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return <Text style={{ fontFamily: fonts.display, fontSize: 17, color: c.ink }}>{children}</Text>
}

/** A message box in the same face as Field, named by its own label. */
export function MessageBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline
        maxLength={4000}
        value={value}
        onChangeText={onChange}
        placeholderTextColor={c.ink3}
        style={{
          minHeight: 112,
          borderRadius: 14,
          borderWidth: 1.5,
          paddingHorizontal: 14,
          paddingVertical: 10,
          textAlignVertical: 'top',
          fontFamily: fonts.ui,
          fontSize: 15,
          backgroundColor: c.page,
          borderColor: c.control,
          color: c.ink,
        }}
      />
    </View>
  )
}

/** A choice of one, as Pocket's tabs: cloud, the one chosen in ink. */
export function Choices<T extends string>({ label, options, value, onChange }: { label: string; options: readonly [T, string][]; value: T; onChange: (v: T) => void }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.ink2 }}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(([v, words]) => {
          const on = v === value
          return (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(v)}
              hitSlop={{ top: 6, bottom: 6 }}
              style={{ height: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, backgroundColor: on ? c.primary : c.page }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: on ? c.onPrimary : c.ink }}>{words}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** What happened to the last send: its title and line once sent, or the refusal. */
export type Said = { title: string; line: string } | { refused: string } | null

export function SaidLine({ said }: { said: Said }) {
  const { c } = useTheme()
  if (!said) return null
  if ('refused' in said) {
    return (
      <Text accessibilityRole="alert" style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 22, color: c.danger }}>
        {said.refused}
      </Text>
    )
  }
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{said.title}</Text>
      <Body muted>{said.line}</Body>
    </View>
  )
}

/** Sends one kind of request; `after` is what the screen says once it is sent, and `done` runs after that. */
export function useSend(after: (r: AccountRequest) => { title: string; line: string }, done: () => void) {
  const { client } = useSession()
  const [sending, setSending] = useState(false)
  const [said, setSaid] = useState<Said>(null)
  const send = async (kind: RequestKind, message: string) => {
    if (sending) return
    setSending(true)
    setSaid(null)
    try {
      setSaid(after(await client.sendRequest(kind, message.trim())))
      done()
    } catch (err) {
      setSaid({ refused: refusalLine(err) })
    } finally {
      setSending(false)
    }
  }
  return { send, sending, said, clear: () => setSaid(null) }
}

/** The workspace's requests, newest first, read once and again after each send or pull-down. */
export function useRequests() {
  const { client } = useSession()
  return useLoad(useCallback(() => client.requests(), [client]))
}

/** What was sent of these kinds, newest first, each with its state, its reference and Talyvor's answer. */
export function SentList({ requests, kinds, title, empty }: { requests: ReturnType<typeof useRequests>; kinds: RequestKind[]; title: string; empty: string }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [saving, setSaving] = useState<number | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const mine = (requests.data ?? []).filter((r) => kinds.includes(r.kind))

  const download = async (id: number) => {
    setSaving(id)
    setSaved(null)
    try {
      const name = 'talyvor-data.json'
      const file = new File(Paths.cache, name)
      if (file.exists) file.delete()
      file.create()
      file.write(new Uint8Array(await client.requestExport(id)))
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: name })
    } catch (err) {
      setSaved(refusalText(err))
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card white>
      <CardTitle>{title}</CardTitle>
      {requests.error ? (
        <Body muted>What you sent could not be read just now.</Body>
      ) : requests.loading && !requests.data ? (
        <Body muted>Reading…</Body>
      ) : mine.length === 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink }}>{empty}</Text>
          <Body muted>Anything you send appears here with what Talyvor answers.</Body>
        </View>
      ) : (
        mine.map((r, i) => (
          <View key={r.id} testID={`request-${r.id}`} style={[{ gap: 8, paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: c.line }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiMedium, fontSize: 15, lineHeight: 22, color: c.ink }}>{KIND_TITLE[r.kind]}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: c.ink3 }}>
                  Sent {day(r.filed_at)}
                  {r.reference ? (
                    <>
                      {' · Reference '}
                      <Text style={{ fontFamily: fonts.uiMedium, color: c.ink, fontVariant: ['tabular-nums'] }}>{r.reference}</Text>
                    </>
                  ) : null}
                </Text>
              </View>
              {STATE_CHIP[r.state]}
            </View>
            {r.message ? <Body muted>{r.message}</Body> : null}
            {r.answer ? (
              <View style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.cloud }}>
                <Body>
                  <Text style={{ fontFamily: fonts.uiBold }}>Talyvor’s answer: </Text>
                  {r.answer}
                </Body>
              </View>
            ) : null}
            {r.kind === 'data_export' && r.state === 'done' ? (
              <Button variant="secondary" label={saving === r.id ? 'Preparing…' : 'Download your data'} disabled={saving !== null} onPress={() => void download(r.id)} />
            ) : null}
          </View>
        ))
      )}
      {saved ? <Body style={{ color: c.danger }}>{saved}</Body> : null}
    </Card>
  )
}

