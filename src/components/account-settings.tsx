import { StyleSheet, Text, View } from 'react-native'

import { KIND_LABEL, TYPE_LABEL, type Account } from '../account'
import { KIND_NOTE, TYPE_NOTE } from '../signup-words'
import { fonts, useTheme } from '../theme'
import { Card, Chip, Eyebrow } from './ui'

// B57.138 — Settings' Account section as launch-pack P11 draws it, in the web's words. B61.5 — Nick, 15 Nov: the type
// and the kind of money are fixed once the account is open; another of either is another account, with its own sign-up.
// So both are drawn as facts, each with the sentence sign-up says, and nothing here changes either, as the web's
// (talyvor-suite B61.4, apps/web/src/areas/lens/AccountSettings.tsx). Until "Open another account" ships (B61.9), the
// sentences carry no link.

/** One fact of the account: its title, its chip and the sentence that says it stays. */
function Fact({ title, chip, line, testID }: { title: string; chip: string; line: string; testID: string }) {
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
        <Text style={[styles.line, { color: c.ink2 }]}>{line}</Text>
      </Card>
    </View>
  )
}

/** Settings' Account section: the account's kind of money and its type, neither of which can be changed. */
export function AccountSettings({ account }: { account: Account }) {
  return (
    <>
      <Eyebrow>Account</Eyebrow>
      <Fact title="Kind of money" chip={KIND_LABEL[account.money_kind]} line={KIND_NOTE} testID="settings-money-kind" />
      <Fact title="Account type" chip={TYPE_LABEL[account.account_type]} line={TYPE_NOTE} testID="settings-account-type" />
    </>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: fonts.uiBold, fontSize: 16, lineHeight: 22 },
  line: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 },
})
