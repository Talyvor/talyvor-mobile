import { Redirect } from 'expo-router'

import { useAccount } from '@/account'
import { CompanyDetailsSection } from '@/components/company-details'
import { Back, Headline, Screen } from '@/components/ui'
import { COMPANY_WORDS } from '@/company-words'
import { useSession } from '@/session'

// B59.32 — /settings/company, the web's Settings → Company details (suite B59.31): Business only; a Personal account's
// address opens Home.

export default function CompanyDetailsScreen() {
  const { client } = useSession()
  const { account } = useAccount(client)
  if (account?.account_type === 'personal') return <Redirect href="/" />
  return (
    <Screen>
      <Back home="/settings" />
      <Headline>{COMPANY_WORDS.title}</Headline>
      <CompanyDetailsSection />
    </Screen>
  )
}
