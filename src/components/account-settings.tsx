import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { KIND_LABEL, TYPE_LABEL, type Account } from '../account'
import { KIND_NOTE, TYPE_NOTE } from '../signup-words'
import { fonts, useTheme } from '../theme'
import { Card, Chip, Eyebrow } from './ui'
import { YourAccountsSheet } from './your-accounts'

// B57.138 — Settings' Account section as launch-pack P11 draws it, in the web's words. B61.5 — Nick, 15 Nov: the type
// and the kind of money are fixed once the account is open; another of either is another account, with its own sign-up.
// So both are drawn as facts, each with the sentence sign-up says, and nothing here changes either, as the web's
// (talyvor-suite B61.4, apps/web/src/areas/lens/AccountSettings.tsx). B61.10 — the sentence's "open another account"
// opens Your accounts, where that button is, as the web's B61.9.

const OPEN_ANOTHER = 'open another account'

/** The sentence, its "open another account" opening Your accounts. */
function Line({ line, onOpen }: { line: string; onOpen: () => void }) {
  const { c } = useTheme()
  const at = line.indexOf(OPEN_ANOTHER)
  return (
    <Text style={[styles.line, { color: c.ink2 }]}>
      {at < 0 ? (
        line
      ) : (
        <>
          {line.slice(0, at)}
          <Text accessibilityRole="link" onPress={onOpen} style={{ fontFamily: fonts.uiBold, color: c.ink, textDecorationLine: 'underline' }}>
            {OPEN_ANOTHER}
          </Text>
          {line.slice(at + OPEN_ANOTHER.length)}
        </>
      )}
    </Text>
  )
}

/** One fact of the account: its title, its chip and the sentence that says it stays. */
function Fact({ title, chip, line, testID, onOpen }: { title: string; chip: string; line: string; testID: string; onOpen: () => void }) {
  const { c } = useTheme()
  return (
    <View testID={testID}>
      <Card>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.ink, flex: 1 }]}>
            {title}
          </Text>
          <Chip>{chip}</Chip>
        </View>
        <Line line={line} onOpen={onOpen} />
      </Card>
    </View>
  )
}

/** Settings' Account section: the account's kind of money and its type, neither of which can be changed. */
export function AccountSettings({ account }: { account: Account }) {
  const [open, setOpen] = useState(false)
  const onOpen = () => setOpen(true)
  return (
    <>
      <Eyebrow>Account</Eyebrow>
      <Fact title="Kind of money" chip={KIND_LABEL[account.money_kind]} line={KIND_NOTE} testID="settings-money-kind" onOpen={onOpen} />
      <Fact title="Account type" chip={TYPE_LABEL[account.account_type]} line={TYPE_NOTE} testID="settings-account-type" onOpen={onOpen} />
      <YourAccountsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: fonts.uiBold, fontSize: 16, lineHeight: 22 },
  line: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 },
})
