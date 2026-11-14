import { useState, type ReactNode } from 'react'
import { Modal, Pressable, View } from 'react-native'

import { biometricName } from '../keys'
import { useTheme } from '../theme'
import { Icon } from './icon'
import { Body, Button, Card, Figure, Headline, Sheet } from './ui'

// B57.72 — Pay's confirm step as Pocket's bottom sheet (design/pocket dlg-ppay-k and dlg-ppay-n), and the sheet From opens.

// The web's first-payment questions (talyvor-suite Pay.tsx SCAM_QUESTIONS).
const SCAM_QUESTIONS = [
  { key: 'urgent', text: 'Were you told to pay urgently?' },
  { key: 'details', text: 'Did the bank details arrive by email or chat?' },
] as const
type ScamAnswers = Partial<Record<(typeof SCAM_QUESTIONS)[number]['key'], boolean>>

/** A bottom sheet over the screen: Close and a tap on the dimmed screen above it both close it. Without `onClose` it has
 * neither, and only its own buttons put it away (B57.146: a recovery code shown once). */
export function BottomSheet({ visible, onClose, children, testID }: { visible: boolean; onClose?: () => void; children: ReactNode; testID?: string }) {
  const { c } = useTheme()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose ?? (() => undefined)}>
      <View testID={testID} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,18,22,0.4)' }}>
        <Pressable accessible={false} disabled={!onClose} style={{ flex: 1 }} onPress={onClose} />
        <Sheet>
          {onClose ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose} style={{ alignSelf: 'flex-end' }}>
              <Icon name="x" color={c.ink2} />
            </Pressable>
          ) : null}
          {children}
        </Sheet>
      </View>
    </Modal>
  )
}

/** Pay {payee} {amount}?: what is about to be sent, the first-payment questions, and Face ID, or the way to turn it on.
 * `onPay` is called only once the questions are answered. */
export function ConfirmPayment({
  payee,
  from,
  amount,
  reference,
  first,
  hasKey,
  busy,
  refusal,
  onPay,
  onCancel,
  onApprovals,
}: {
  payee: string
  from: string
  amount: string
  reference: string
  first: boolean
  hasKey: boolean
  busy: boolean
  refusal: string
  onPay: () => void
  onCancel: () => void
  onApprovals: () => void
}) {
  const { c } = useTheme()
  const [answers, setAnswers] = useState<ScamAnswers>({})
  const [checked, setChecked] = useState(false)
  const warned = !!(answers.urgent || answers.details)
  const answered = !first || (SCAM_QUESTIONS.every((q) => answers[q.key] !== undefined) && (!warned || checked))
  return (
    <>
      <Headline>
        Pay {payee} {amount}?
      </Headline>
      <Card>
        {[
          ['From', from],
          ['To', payee],
          ['Amount', amount],
          ['Reference', reference || 'None'],
        ].map(([label, value]) => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Body muted>{label}</Body>
            {label === 'Amount' ? <Figure>{value}</Figure> : <Body style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Body>}
          </View>
        ))}
      </Card>
      {first
        ? SCAM_QUESTIONS.map((q) => (
            <View key={q.key} style={{ gap: 8 }}>
              <Body>{q.text}</Body>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {([true, false] as const).map((yes) => (
                  <Pressable
                    key={String(yes)}
                    accessibilityRole="button"
                    accessibilityLabel={`${q.text} ${yes ? 'Yes' : 'No'}`}
                    accessibilityState={{ selected: answers[q.key] === yes }}
                    onPress={() => setAnswers((a) => ({ ...a, [q.key]: yes }))}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderWidth: 1.5, borderRadius: 999, borderColor: answers[q.key] === yes ? c.ink : c.control, backgroundColor: answers[q.key] === yes ? c.ink : 'transparent' }}>
                    <Body style={{ color: answers[q.key] === yes ? c.page : c.ink }}>{yes ? 'Yes' : 'No'}</Body>
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        : null}
      {first && warned ? (
        <>
          <Body style={{ color: c.caution }}>
            {`Stop and check. This could be a scam. Fraudsters rush people into paying, and they send or change bank details by email or chat. Before you pay, call ${payee} on a number you already have, not one from the message, and check the details. Money sent to a fraudster is often not recovered.`}
          </Body>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setChecked((v) => !v)} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 22, height: 22, borderWidth: 1.5, borderRadius: 6, borderColor: checked ? c.ink : c.control, backgroundColor: checked ? c.ink : 'transparent' }} />
            <View style={{ flex: 1 }}>
              <Body>{`I have checked the details with ${payee} directly and still want to pay.`}</Body>
            </View>
          </Pressable>
        </>
      ) : null}
      {first ? <Body muted>{`This is your first payment to ${payee}, so Talyvor asks two questions first.`}</Body> : null}
      {hasKey ? (
        <Button
          primary
          label={`Pay with ${biometricName}`}
          disabled={busy || !answered}
          hint={busy ? 'Paying…' : warned && !checked ? 'Tick the box first.' : 'Answer both questions first.'}
          onPress={onPay}
        />
      ) : (
        <>
          <Body muted>{`Turn on Approve with ${biometricName} on this phone first: Talyvor asks for ${biometricName} before each payment from this phone.`}</Body>
          <Button primary label="Approvals on this phone" onPress={onApprovals} />
        </>
      )}
      <Button variant="secondary" label="Cancel" disabled={busy} hint="Paying…" onPress={onCancel} />
      {refusal ? <Body style={{ color: c.danger }}>{refusal}</Body> : null}
      <Body muted>{`${biometricName === 'Face ID' ? 'Face ID asks' : 'Your fingerprint is asked for'} before anything is sent. A cancelled ${biometricName === 'Face ID' ? 'Face ID' : 'fingerprint check'} pays nothing.`}</Body>
    </>
  )
}

/** One open account in From's sheet: its name and its balance. */
export function AccountChoice({ name, balance, chosen, onPress }: { name: string; balance: string; chosen: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${balance}`}
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5, borderColor: chosen ? c.ink : c.control }}>
      <Body style={{ flex: 1 }}>{name}</Body>
      <Figure>{balance}</Figure>
    </Pressable>
  )
}
