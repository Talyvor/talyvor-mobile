import { formatMinor, type CardSpend } from '@talyvor/bff-client'
import { router } from 'expo-router'
import type { ComponentProps } from 'react'
import { View } from 'react-native'

import { Body, Button, Card, Chip, Eyebrow, Figure, Row } from '@/components/ui'

// B59.55 — an agent's one-time and standing cards under its card on Cards (Lens B59.21, read through the BFF's B59.54).
// On a preapproved card programme the agent asks first, naming the merchant and the amount; within its rules, or once the
// owner approves, Lens issues a one-time card for that amount locked to the merchant, or raises the standing card the
// agent names (a subscription's) by it until its time ends. Either way the card spends no more than the budget approved.
// The web's Cards (B59.45) has no words for these yet: each line here is listed under "Words to confirm".

export const CARD_SPEND_WORDS = {
  title: 'One-time and standing cards',
  oneTime: 'One-time card',
  standing: 'Standing card',
  approved: 'Budget you approved',
  until: (on: string) => `Budget you approved, until ${on}`,
  issuing: 'Budget you approved. Being issued.',
  ended: (on: string) => `Raise ended ${on}`,
  expired: 'Expired',
  waiting: 'Waiting for your approval',
  openApprovals: 'Open Approvals',
  notApproved: 'Not approved',
  failed: 'Not issued',
  readFailed: 'Its one-time and standing cards could not be read just now.',
}
const W = CARD_SPEND_WORDS
type ChipTone = NonNullable<ComponentProps<typeof Chip>['tone']>

const on = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** What a card spend is and where it stands, in words. */
export function spendState(s: CardSpend): { text: string; chip: string; tone: ChipTone } {
  const standing = !!s.standing_card_id
  switch (s.status) {
    case 'awaiting_approval':
      return { text: W.waiting, chip: 'Waiting', tone: 'wait' }
    case 'issuing':
      return { text: W.issuing, chip: 'Approved', tone: 'good' }
    case 'active':
      return { text: standing && s.expires_at ? W.until(on(s.expires_at)) : W.approved, chip: 'Approved', tone: 'good' }
    case 'expired':
      return { text: standing && s.expires_at ? W.ended(on(s.expires_at)) : W.expired, chip: 'Ended', tone: 'paused' }
    case 'failed':
      return { text: s.detail || W.failed, chip: 'Not issued', tone: 'bad' }
    default:
      return { text: s.detail || W.notApproved, chip: 'Not approved', tone: 'bad' }
  }
}

/** The agent's one-time and standing cards, newest first as Lens lists them; nothing when it has none. `null` is a read
 * that failed, which says so and raises nothing. */
export function CardSpends({ spends }: { spends: CardSpend[] | null }) {
  if (spends === null) return <Body muted>{W.readFailed}</Body>
  if (!spends.length) return null
  const waiting = spends.some((s) => s.status === 'awaiting_approval')
  return (
    <View style={{ gap: 8 }} testID="card-spends">
      <Eyebrow>{W.title}</Eyebrow>
      <Card>
        {spends.map((s, i) => {
          const state = spendState(s)
          return (
            <View key={s.id} testID={`card-spend-${s.id}`}>
              <Row
                first={i === 0}
                title={`${s.standing_card_id ? W.standing : W.oneTime} · ${s.merchant}`}
                sub={state.text}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Figure>{formatMinor(s.amount_minor, s.currency.toUpperCase())}</Figure>
                    <Chip tone={state.tone}>{state.chip}</Chip>
                  </View>
                }
              />
            </View>
          )
        })}
      </Card>
      {waiting ? <Button testID="card-spends-approvals" label={W.openApprovals} onPress={() => router.push('/approvals')} /> : null}
    </View>
  )
}
