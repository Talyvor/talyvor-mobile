import { formatULXC, refusalText, type AgentApproval } from '@talyvor/bff-client'
import { useState } from 'react'
import { View } from 'react-native'

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
      await client[decision](approval.id)
      onDecided()
    } catch (err) {
      setRefusal(refusalText(err))
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
