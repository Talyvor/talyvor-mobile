import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'

import { MONEY_WALLET, MoneyLabel } from '@/components/money-label'
import { DownloadSheet, StatementPaper, useStatement, useStatementSources } from '@/components/statement-paper'
import { Back, Button, Headline, LoadState, Screen } from '@/components/ui'
import { statementPeriods } from '@/statements'

// B61.135 — the whole statement (pocket-live PS.statement), pushed by See all from Activity › Statements: every line, how
// it adds up, and Download statement docked at the foot.

export default function StatementsScreen() {
  const params = useLocalSearchParams<{ account?: string; period?: string }>()
  const sources = useStatementSources()
  const periods = statementPeriods()
  const source = sources.data?.sources.find((s) => s.id === params.account) ?? sources.data?.sources[0]
  const period = periods.find((p) => p.id === params.period) ?? periods[0]
  const statement = useStatement(source, period)
  const [downloading, setDownloading] = useState(false)
  return (
    <Screen
      onRefresh={statement.reload}
      refreshing={statement.loading && !!statement.data}
      footer={<Button primary icon="dl" label="Download statement" disabled={!source} onPress={() => setDownloading(true)} />}>
      <Back home="/activity" />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Headline>Statement</Headline>
        <MoneyLabel capability={MONEY_WALLET} />
      </View>
      <LoadState loading={(sources.loading && !sources.data) || (statement.loading && !statement.data)} error={sources.error ?? statement.error} />
      {source && sources.data && statement.data ? <StatementPaper statement={statement.data} source={source} period={period} names={sources.data} /> : null}
      {downloading && source ? <DownloadSheet source={source} period={period} onClose={() => setDownloading(false)} /> : null}
    </Screen>
  )
}
