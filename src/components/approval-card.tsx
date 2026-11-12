import { BffError, formatLXC, refusalText, type AgentApproval } from '@talyvor/bff-client'
import { useState } from 'react'
import { View } from 'react-native'

import { biometricName, phoneKey, signWithThisPhone } from '../keys'
import { syncLiveActivities } from '../live-activity'
import { useSession } from '../session'
import { useTheme } from '../theme'
import { MoneyLabel } from './money-label'
import { Body, Button, Card, Field, Figure } from './ui'

/** What a decline did, said where the person declined it (B55.20, the web's words from B55.19). */
export const declinedText = (agentName: string, a: AgentApproval) =>
  `Declined. ${agentName}’s ${a.payee ? 'payment' : 'request'} is refused, and the same request is refused without asking you for 24 hours.`

/** One approval waiting for the owner: what, how much, why, Live or Sandbox for the capability it moves money on, and
 * approve or decline. Decline asks why first: optional, kept by Lens and shown to the agent (B55.18). `onDecided` gets
 * what a decline did, for the screen to say once the card is gone. */
export function ApprovalCard({
  approval,
  agentName,
  capability,
  onDecided,
}: {
  approval: AgentApproval
  agentName: string
  capability: string
  onDecided: (said?: string) => void
}) {
  const { client, peg } = useSession()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [declining, setDeclining] = useState(false)
  const [why, setWhy] = useState('')
  const what = approval.payee ? `Pay ${approval.payee.name || approval.payee.id}` : `Ask ${approval.model}`

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true)
    setRefusal('')
    try {
      // With this phone's key on, Lens takes the decision only signed: Face ID or a fingerprint, over this approval's challenge.
      // Approving moves money, so on a phone it is never made unsigned (B50.10); declining moves none and may be.
      // A key made in another workspace is no key here: Lens refuses it.
      const key = await phoneKey(client)
      if (decision === 'approve' && !key) throw new Error(`turn on approving with ${biometricName} on this phone first.`)
      if (decision === 'approve' && !key?.here) throw new Error(`approving with ${biometricName} is off for this workspace.`)
      const assertion = key?.here
        ? await signWithThisPhone(client, (await client.approvalChallenge(approval.id)).challenge, `${decision === 'approve' ? 'Approve' : 'Decline'} ${formatLXC(approval.amount_ulxc, peg)} for ${agentName}`)
        : undefined
      if (decision === 'approve') await client.approve(approval.id, assertion)
      else await client.deny(approval.id, assertion, why.trim())
      void syncLiveActivities(client)
      onDecided(decision === 'deny' ? declinedText(agentName, approval) : undefined)
    } catch (err) {
      setRefusal(err instanceof BffError ? refusalText(err) : `Nothing changed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Body style={{ flex: 1 }}>
          {agentName} wants to {what.charAt(0).toLowerCase() + what.slice(1)}
        </Body>
        <Figure>{formatLXC(approval.amount_ulxc, peg)}</Figure>
      </View>
      <MoneyLabel capability={capability} />
      {approval.reason ? <Body muted>“{approval.reason}”</Body> : null}
      {approval.memo ? <Body muted>{approval.memo}</Body> : null}
      {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
      {declining ? (
        <>
          <Field label="Why (optional, the agent sees it)" value={why} onChangeText={setWhy} maxLength={200} autoFocus />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Button primary label="Decline" disabled={busy} onPress={() => void decide('deny')} />
            <Button label="Cancel" disabled={busy} onPress={() => setDeclining(false)} />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <Button primary label="Approve" disabled={busy} onPress={() => void decide('approve')} />
          <Button label="Decline" disabled={busy} onPress={() => setDeclining(true)} />
        </View>
      )}
    </Card>
  )
}
