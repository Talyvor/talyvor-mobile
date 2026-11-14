import { formatMinor, type InstantTransfer } from '@talyvor/bff-client'
import * as Clipboard from 'expo-clipboard'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useAccount } from '@/account'
import { Icon } from '@/components/icon'
import { MoneyLabel } from '@/components/money-label'
import { Back, Body, Button, Card, Chip, Eyebrow, Headline, LoadState, Screen, useLoad } from '@/components/ui'
import {
  BALANCE_WORDS,
  INSTANT_TRANSFER,
  STATUS_WORDS,
  STEPS,
  WORDS,
  arrivesText,
  conversions,
  finished,
  onChainReference,
  receiptWhen,
  reversedText,
  stepLines,
  stepStates,
} from '@/instant-transfer'
import { useSession } from '@/session'
import { fonts, useTheme } from '@/theme'

// B59.20 — an Instant transfer once sent (design P9 and P10, launch pack 4.1): its progress — Sent, Converted, On its way,
// Received, or reversed with the agent's money back — read from Lens every second until it lands, then See the receipt:
// both conversions and the on-chain reference. Hybrid only.

export default function InstantTransferProgressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client } = useSession()
  const { shows } = useAccount(client)
  const load = useCallback(async () => {
    const [t, book] = await Promise.all([client.instantTransfer(id), client.book()])
    return { t, agents: book.agents ?? [] }
  }, [client, id])
  const { data, error, loading, reload } = useLoad(load)
  const [receipt, setReceipt] = useState(false)
  // Read again every second until it lands or is reversed.
  const moving = !!data && !finished(data.t)
  useEffect(() => {
    if (!moving) return
    const timer = setTimeout(reload, 1000)
    return () => clearTimeout(timer)
  }, [moving, data, reload])

  if (shows && !shows.instantTransfer) return <Redirect href="/pay" />
  const t = data?.t
  const agent = data?.agents.find((a) => a.id === t?.agent_id)?.name ?? 'The agent'
  const showReceipt = receipt && t?.status === 'received'
  return (
    <Screen>
      <Back home="/pay" />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>{showReceipt ? WORDS.receipt : WORDS.title}</Headline>
        <MoneyLabel capability={INSTANT_TRANSFER} />
      </View>
      {!data && error ? (
        <>
          <Body muted>We couldn’t read this receipt.</Body>
          <Button small variant="secondary" label={WORDS.tryAgain} onPress={reload} />
        </>
      ) : !t ? (
        <LoadState loading={loading} error={null} />
      ) : showReceipt ? (
        <Receipt t={t} agent={agent} />
      ) : (
        <Progress t={t} agent={agent} onReceipt={() => setReceipt(true)} />
      )}
    </Screen>
  )
}

function Progress({ t, agent, onReceipt }: { t: InstantTransfer; agent: string; onReceipt: () => void }) {
  const { c } = useTheme()
  const states = stepStates(t.status)
  const lines = stepLines(t, agent)
  const reversed = t.status === 'reversed'
  return (
    <View testID="instant-progress" style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text testID="instant-status" style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: reversed ? c.danger : c.ink3 }}>
          {STATUS_WORDS[t.status]}
        </Text>
        <Text style={{ fontFamily: fonts.display, fontSize: 44, color: c.ink, fontVariant: ['tabular-nums'] }}>{formatMinor(t.send_minor, t.send_currency)}</Text>
        <Body>
          {'to '}
          <Text style={{ fontFamily: fonts.uiBold }}>{t.beneficiary_name}</Text>
        </Body>
        <View style={{ flexDirection: 'row' }}>{reversed ? <Chip tone="bad">Reversed</Chip> : <Chip>{arrivesText(t, new Date(t.created_at))}</Chip>}</View>
      </View>
      <Card white>
        <View accessibilityLabel="Progress" style={{ gap: 14 }}>
          {STEPS.map((step, i) => {
            const state = states[i]
            return (
              <View
                key={step}
                testID={`instant-step-${state}`}
                accessible
                accessibilityLabel={`${state === 'failed' ? STATUS_WORDS.reversed : step}, ${lines[i]}, ${state === 'done' ? 'step done' : state === 'current' ? 'step in progress' : 'step not started'}`}
                style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View
                  style={{
                    marginTop: 2,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: state === 'done' ? c.ink : state === 'failed' ? c.danger : state === 'current' ? c.page : c.cloud2,
                    borderWidth: state === 'current' ? 2 : 0,
                    borderColor: c.ink,
                  }}>
                  {state === 'done' ? <Icon name="check" size={12} color={c.page} /> : state === 'failed' ? <Icon name="x" size={12} color={c.page} /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: state === 'next' ? c.ink3 : c.ink }}>{state === 'failed' ? STATUS_WORDS.reversed : step}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: c.ink3 }}>{lines[i]}</Text>
                </View>
                {state === 'current' ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3 }}>Now</Text> : null}
              </View>
            )
          })}
        </View>
      </Card>
      {reversed ? (
        <Body style={{ color: c.danger }}>{reversedText(t, agent)}</Body>
      ) : t.status !== 'received' ? (
        <Body muted>{WORDS.leave}</Body>
      ) : null}
      <Button primary label={WORDS.done} onPress={() => router.replace('/pay')} />
      {t.status === 'received' ? (
        <Button variant="secondary" label={WORDS.seeReceipt} onPress={onReceipt} />
      ) : (
        <Button variant="secondary" label={WORDS.seeActivity} onPress={() => router.push('/activity')} />
      )}
    </View>
  )
}

function Receipt({ t, agent }: { t: InstantTransfer; agent: string }) {
  const { c } = useTheme()
  const [copied, setCopied] = useState(false)
  const ref = onChainReference(t)
  const steps = conversions(t)
  const fact = (label: string, value: string, i: number, right?: ReactNode) => (
    <View key={label} accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
      <Body muted>{label}</Body>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
        <Text style={{ flexShrink: 1, textAlign: 'right', fontFamily: fonts.uiMedium, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
        {right}
      </View>
    </View>
  )
  return (
    <View testID="instant-receipt" style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row' }}>
        <Chip tone="good">Received</Chip>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 44, color: c.ink, fontVariant: ['tabular-nums'] }}>{formatMinor(t.send_minor, t.send_currency)}</Text>
        <Body>
          {'to '}
          <Text style={{ fontFamily: fonts.uiBold }}>{t.beneficiary_name}</Text>
        </Body>
        <Body muted>{receiptWhen(t)}</Body>
      </View>
      <Card white>
        {[
          [WORDS.youSent, formatMinor(t.send_minor, t.send_currency)],
          [WORDS.fee, formatMinor(t.fee_minor, t.send_currency)],
          [WORDS.theyGot, formatMinor(t.receive_minor, t.receive_currency)],
        ].map(([label, value], i) => fact(label, value, i))}
      </Card>
      {steps.length > 0 ? (
        <View testID="instant-conversions" style={{ gap: 8 }}>
          <Eyebrow>{WORDS.conversions}</Eyebrow>
          <Card white>
            {steps.map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: c.ink3 }}>{i + 1}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: fonts.uiMedium, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{s.text}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: c.ink3, fontVariant: ['tabular-nums'] }}>{s.rate}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
      <Card white>
        {[
          ...(ref
            ? [
                fact(
                  WORDS.onChainReference,
                  ref,
                  0,
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy the on-chain reference"
                    hitSlop={10}
                    onPress={() => void Clipboard.setStringAsync(ref).then(() => setCopied(true))}>
                    <Icon name={copied ? 'check' : 'copy'} size={16} color={c.ink2} />
                  </Pressable>,
                ),
              ]
            : []),
          fact(WORDS.transferId, t.id, ref ? 1 : 0),
          fact(WORDS.paidFrom, `${agent}’s ${BALANCE_WORDS[t.send_currency] ?? t.send_currency} balance`, 1),
        ]}
      </Card>
      {copied ? <Body muted>Copied</Body> : null}
      <Button primary label={WORDS.done} onPress={() => router.replace('/pay')} />
    </View>
  )
}
