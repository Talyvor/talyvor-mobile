import { BffError, formatMinor, MONEY_STATEMENT_MIME, refusalText, type MoneyStatement, type MoneyStatementFormat } from '@talyvor/bff-client'
import { File, Paths } from 'expo-file-system'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native'
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import { useSession } from '../session'
import { outcome, play } from '../sound'
import { addsUp, STATEMENT_FORMATS, statementFileName, statementLine, statementPeriods, statementSources, type StatementPeriod, type StatementSource } from '../statements'
import { fonts, SurfaceContext, useTheme } from '../theme'
import { useTick } from './effects'
import { Icon } from './icon'
import { say } from './live'
import { Pick } from './look-and-sound'
import { MONEY_WALLET, MoneyLabel } from './money-label'
import { BottomSheet } from './pay-sheet'
import { Body, Button, Chip, Eyebrow, LoadState, Note, useLoad } from './ui'

// B61.135 — Statements on the phone (design/pocket-live DESIGN.md 16.2, stPhone, PS.statement and SH.stdl): one sheet of
// paper, the twin of the PDF, for one balance or one agent over one period, and Download statement, which fetches the
// PDF, the Excel sheet or the CSV Lens writes (B61.131, B61.132) and opens the phone's share sheet with it.

const LOGO = {
  light: require('../../assets/logo/talyvor-logo-small-on-light-480.png'),
  dark: require('../../assets/logo/talyvor-logo-small-on-dark-480.png'),
}

/** Who a line was with, by account id and by agent id. */
type Names = { accountName: (id: string) => string | undefined; agentName: (id: string) => string | undefined }

/** The accounts a statement can be for and the agents' names, read once. */
export function useStatementSources() {
  const { client } = useSession()
  const load = useCallback(async () => {
    const [{ accounts }, book] = await Promise.all([client.moneyAccounts(), client.book()])
    const agents = new Map((book.agents ?? []).map((a) => [a.id, a.name]))
    const names = new Map((accounts ?? []).map((a) => [a.id, a.purpose === 'company' ? 'The company' : (agents.get(a.agent_id ?? '') ?? a.name)]))
    return { sources: statementSources(accounts ?? [], (id) => agents.get(id)), agentName: (id: string) => agents.get(id), accountName: (id: string) => names.get(id) }
  }, [client])
  return useLoad(load)
}

/** One account's statement over one period. */
export function useStatement(source: StatementSource | undefined, period: StatementPeriod) {
  const { client } = useSession()
  const load = useCallback(async () => (source ? client.accountStatement(source.id, period.from, period.to) : null), [client, source, period.from, period.to])
  return useLoad(load)
}

/** The paper's nine tangerine streams, running in from the right edge and fading towards the left (ST_STREAMS). */
function Streams() {
  const { c } = useTheme()
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, width: '64%', aspectRatio: 2, opacity: 0.62 }}>
      <Svg width="100%" height="100%" viewBox="0 0 300 150">
        <Defs>
          <LinearGradient id="statement-fade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0.06" stopColor={c.tangerine} stopOpacity={0} />
            <Stop offset="1" stopColor={c.tangerine} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        {Array.from({ length: 9 }, (_, i) => (
          <Path
            key={i}
            d={`M300 ${8 + i * 13.5} C 228 ${8 + i * 13.5}, 150 ${34 + i * 5.4}, 0 ${58 + i * 1.4}`}
            fill="none"
            stroke="url(#statement-fade)"
            strokeWidth={i % 3 ? 1.1 : 1.5}
            strokeOpacity={0.9 - (i % 4) * 0.14}
          />
        ))}
      </Svg>
    </View>
  )
}

/** The statement as one sheet of paper: solid, the one surface that is not glass. `max` cuts it to its first lines with
 * See all under them; without it the whole statement ends with how it adds up. */
export function StatementPaper(props: { statement: MoneyStatement; source: StatementSource; period: StatementPeriod; names: Names; max?: number; onMore?: () => void }) {
  return (
    <SurfaceContext.Provider value="plain">
      <Paper {...props} />
    </SurfaceContext.Provider>
  )
}

function Paper({ statement, source, period, names, max, onMore }: Parameters<typeof StatementPaper>[0]) {
  const { c, dark } = useTheme()
  const cur = statement.currency
  const money = (minor: number) => formatMinor(minor, cur)
  const totals = { opening: statement.opening_minor ?? 0, in: statement.in_minor ?? 0, out: statement.out_minor ?? 0, closing: statement.closing_minor ?? 0 }
  const all = (statement.lines ?? []).map((l) => statementLine(l, names.accountName, names.agentName))
  const cut = max !== undefined && all.length > max
  const lines = cut ? all.slice(0, max) : all
  const [sum, closing] = addsUp(totals, cur)
  const band: [string, number][] = [
    ['Opening balance', totals.opening],
    ['Money in', totals.in],
    ['Money out', totals.out],
    [period.now ? 'Balance now' : 'Closing balance', totals.closing],
  ]
  return (
    <View testID="statement-paper" style={{ overflow: 'hidden', borderRadius: 24, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 4, backgroundColor: c.page, boxShadow: `0 0 0 1px ${c.line}, 0 18px 40px -26px rgba(17,18,22,0.4)` }}>
      <Streams />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Image source={dark ? LOGO.dark : LOGO.light} accessibilityLabel="Talyvor" contentFit="contain" style={{ width: 120, height: (120 * 153) / 480 }} />
        <MoneyLabel capability={MONEY_WALLET} />
      </View>
      <Eyebrow>Statement</Eyebrow>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: c.ink, marginTop: 4 }}>
        {period.name}
      </Text>
      <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: c.ink2, marginTop: 5 }}>{`${source.name} · ${period.range}`}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', backgroundColor: c.cloud, borderRadius: 18, marginTop: 16, marginBottom: 4 }}>
        {band.map(([label, minor], i) => {
          const last = i === band.length - 1
          return (
            <View key={label} accessible accessibilityLabel={`${label} ${money(minor)}`} style={[{ width: '50%', paddingVertical: 12, paddingHorizontal: 14, gap: 5 }, last && { backgroundColor: c.ink, borderRadius: 18 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {last ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.tangerine }} /> : null}
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiMedium, fontSize: 11, letterSpacing: 0.44, textTransform: 'uppercase', color: last ? c.cloud2 : c.ink2 }}>
                  {label}
                </Text>
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.36, color: last ? c.page : c.ink, fontVariant: ['tabular-nums'] }}>
                {money(minor)}
              </Text>
            </View>
          )
        })}
      </View>
      {lines.length === 0 ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: c.ink2, textAlign: 'center', paddingVertical: 28 }}>Nothing moved in this period.</Text>
      ) : (
        lines.map((l, i) => (
          <View key={l.key} testID="statement-line" style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 8 }, i > 0 && { borderTopWidth: 1, borderTopColor: c.line }]}>
            <View style={{ width: 32, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.uiMedium, fontSize: 16, color: c.ink }}>{l.day}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: c.ink3 }}>{l.month}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiMedium, fontSize: 15, color: c.ink }}>
                  {l.name}
                </Text>
                {l.state ? <Chip tone={l.state === 'Pending' ? 'wait' : 'bad'}>{l.state}</Chip> : null}
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: c.ink3 }}>
                {l.sub}
              </Text>
              {l.task ? (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: c.ink3 }}>
                  {`The agent says: ${l.task}`}
                </Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 1 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: l.minor > 0 ? c.success : c.ink, fontVariant: ['tabular-nums'] }}>{(l.minor > 0 ? '+' : '') + money(l.minor)}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: c.ink3, fontVariant: ['tabular-nums'] }}>{money(l.balance)}</Text>
            </View>
          </View>
        ))
      )}
      {cut ? (
        <Pressable accessibilityRole="button" onPress={onMore} style={{ height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderTopWidth: 1, borderTopColor: c.line }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: c.ink }}>{`See all ${all.length} lines`}</Text>
          <Icon name="chev" size={16} color={c.ink} />
        </Pressable>
      ) : (
        <Text testID="statement-adds-up" style={{ paddingTop: 14, paddingBottom: 12, borderTopWidth: 1, borderTopColor: c.line, fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 19, color: c.ink2, fontVariant: ['tabular-nums'] }}>
          {sum}
          <Text style={{ fontFamily: fonts.uiBold, color: c.ink, textDecorationLine: 'underline', textDecorationColor: c.tangerine }}>{closing}</Text>
        </Text>
      )}
    </View>
  )
}

/** A choice of radio rows in a sheet: Statement for, Period, and the file to download. */
function Choices<T extends string>({ title, options, value, onPick }: { title: string; options: readonly { id: T; title: string; line?: string }[]; value: T; onPick: (id: T) => void }) {
  const { c } = useTheme()
  const { height } = useWindowDimensions()
  return (
    <>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: c.ink }}>
        {title}
      </Text>
      <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={{ gap: 8 }}>
        <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: 8 }}>
          {options.map((o) => (
            <Pick key={o.id} picked={o.id === value} title={o.title} line={o.line} onPick={() => onPick(o.id)} />
          ))}
        </View>
      </ScrollView>
    </>
  )
}

/** Download statement's sheet: PDF, Excel or CSV, and the button that names the choice. The press fetches the file, ticks,
 * closes the sheet and opens the phone's share sheet with it. */
export function DownloadSheet({ source, period, onClose }: { source: StatementSource; period: StatementPeriod; onClose: () => void }) {
  const { client } = useSession()
  const { c } = useTheme()
  const [format, setFormat] = useState<MoneyStatementFormat>('pdf')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const { ticked, tick } = useTick()
  const chosen = STATEMENT_FORMATS.find((f) => f.format === format)!
  const download = async () => {
    setBusy(true)
    setRefusal('')
    try {
      const name = `${statementFileName(source, period.from, period.to)}.${format}`
      const bytes = await client.accountStatementFile(source.id, period.from, period.to, format)
      const file = new File(Paths.cache, name)
      if (file.exists) file.delete()
      file.create()
      file.write(new Uint8Array(bytes))
      play('tick')
      await tick()
      onClose()
      await Sharing.shareAsync(file.uri, { mimeType: MONEY_STATEMENT_MIME[format], dialogTitle: name })
      say(`${chosen.name} ready. Save it or share it`, 'dl')
    } catch (err) {
      if (err instanceof BffError) outcome('refused')
      setRefusal(refusalText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet visible onClose={busy ? undefined : onClose} testID="statement-download" edge={false}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: c.ink }}>
            Download statement
          </Text>
          <MoneyLabel capability={MONEY_WALLET} />
        </View>
        <Body muted>{`${source.name} · ${period.name}`}</Body>
        <View accessibilityRole="radiogroup" accessibilityLabel="File" style={{ gap: 8 }}>
          {STATEMENT_FORMATS.map((f) => (
            <Pick key={f.format} picked={f.format === format} title={f.name} line={f.line} icon={f.icon} onPick={() => !busy && setFormat(f.format)} />
          ))}
        </View>
        <Button primary icon="dl" label={`Download ${chosen.name}`} disabled={busy} done={ticked} hint="Preparing…" onPress={() => void download()} />
        {refusal ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="x" size={16} color={c.danger} />
            <Body style={{ flex: 1, color: c.danger }}>{refusal}</Body>
          </View>
        ) : null}
      </View>
    </BottomSheet>
  )
}

/** Activity › Statements: Statement for and Period, the paper with its first 4 lines, and Download statement. */
export function StatementsTab() {
  const sources = useStatementSources()
  const periods = statementPeriods()
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [periodId, setPeriodId] = useState('m0')
  const [open, setOpen] = useState<'source' | 'period' | 'download' | null>(null)
  const list = sources.data?.sources ?? []
  const source = list.find((s) => s.id === sourceId) ?? list[0]
  const period = periods.find((p) => p.id === periodId) ?? periods[0]
  const statement = useStatement(source, period)
  const { c } = useTheme()
  const pick = (then: () => void) => {
    then()
    setOpen(null)
  }
  if (sources.data && !source) return <Body muted>There is no balance to state yet.</Body>
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            ['source', 'Statement for', source?.name ?? ''],
            ['period', 'Period', period.name],
          ] as const
        ).map(([which, label, value]) => (
          <Pressable
            key={which}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${value}`}
            disabled={!source}
            onPress={() => setOpen(which)}
            style={{ flex: 1, minHeight: 58, borderRadius: 18, paddingVertical: 10, paddingLeft: 14, paddingRight: 12, backgroundColor: c.cloud, gap: 2 }}>
            <Text style={{ fontFamily: fonts.uiMedium, fontSize: 11.5, color: c.ink2 }}>{label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 14.5, color: c.ink }}>
                {value}
              </Text>
              <View style={{ transform: [{ rotate: '90deg' }] }}>
                <Icon name="chev" size={16} color={c.ink2} />
              </View>
            </View>
          </Pressable>
        ))}
      </View>
      <LoadState loading={(sources.loading && !sources.data) || (statement.loading && !statement.data)} error={sources.error ?? statement.error} />
      {source && sources.data && statement.data ? (
        <StatementPaper statement={statement.data} source={source} period={period} names={sources.data} max={4} onMore={() => router.push({ pathname: '/statements', params: { account: source.id, period: period.id } })} />
      ) : null}
      <Button primary icon="dl" label="Download statement" disabled={!source} onPress={() => setOpen('download')} />
      <Note icon="doc">As a PDF, an Excel sheet or a CSV file. All three carry the same lines and the same totals.</Note>
      {open === 'source' ? (
        <BottomSheet visible onClose={() => setOpen(null)} testID="statement-for" edge={false}>
          <Choices
            title="Statement for"
            options={list.map((s) => ({ id: s.id, title: s.name, line: `Holds ${formatMinor(s.holds, s.currency)}` }))}
            value={source?.id ?? ''}
            onPick={(id) => pick(() => setSourceId(id))}
          />
        </BottomSheet>
      ) : null}
      {open === 'period' ? (
        <BottomSheet visible onClose={() => setOpen(null)} testID="statement-period" edge={false}>
          <Choices title="Period" options={periods.map((p) => ({ id: p.id, title: p.name, line: p.range }))} value={period.id} onPick={(id) => pick(() => setPeriodId(id))} />
        </BottomSheet>
      ) : null}
      {open === 'download' && source ? <DownloadSheet source={source} period={period} onClose={() => setOpen(null)} /> : null}
    </View>
  )
}
