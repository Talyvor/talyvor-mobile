import { BffError, formatULXC, refusalText, type AgentApproval } from '@talyvor/bff-client'
import { useState } from 'react'
import { View } from 'react-native'

import { biometricName, signWithThisPhone, thisPhoneDevice } from '../keys'
import { syncLiveActivities } from '../live-activity'
import { useSession } from '../session'
import { useTheme } from '../theme'
import { Body, Button, Card, Figure } from './ui'

/** One approval waiting for the owner: what, how much, why — and approve or deny. */
export function ApprovalCard({ approval, agentName, onDecided }: { approval: AgentApproval; agentName: string; onDecided: () => void }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const what = approval.payee ? `Pay ${approval.payee.name || approval.payee.id}` : `Ask ${approval.model}`

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true)
    setRefusal('')
    try {
      // With this phone's key on, Lens takes the decision only signed: Face ID or a fingerprint, over this approval's challenge.
      // Approving moves money, so on a phone it is never made unsigned (B50.10); denying moves none and may be.
      const device = await thisPhoneDevice()
      if (decision === 'approve' && !device) throw new Error(`turn on approving with ${biometricName} on this phone first.`)
      const assertion = device
        ? await signWithThisPhone((await client.approvalChallenge(approval.id)).challenge, `${decision === 'approve' ? 'Approve' : 'Deny'} ${formatULXC(approval.amount_ulxc)} for ${agentName}`)
        : undefined
      await client[decision](approval.id, assertion)
      void syncLiveActivities(client)
      onDecided()
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
        <Figure>{formatULXC(approval.amount_ulxc)}</Figure>
      </View>
      {approval.reason ? <Body muted>“{approval.reason}”</Body> : null}
      {approval.memo ? <Body muted>{approval.memo}</Body> : null}
      {refusal ? <Body style={{ color: c.critical }}>{refusal}</Body> : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <Button primary label="Approve" disabled={busy} onPress={() => void decide('approve')} />
        <Button label="Deny" disabled={busy} onPress={() => void decide('deny')} />
      </View>
    </Card>
  )
}
