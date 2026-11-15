import { IdentityChecks } from '@/components/identity-checks'
import { Back, Button, Headline, Screen } from '@/components/ui'
import { IDENTITY_WORDS, SIGNUP_STEPS } from '@/signup-words'
import { router } from 'expo-router'

// B61.21 — /settings/verification, the web's Settings → Verification (suite B61.20): the identity check outside sign-up,
// where Home's "Finish confirming who you are" leads.

export default function VerificationScreen() {
  return (
    <Screen>
      <Back home="/settings" />
      <Headline>{SIGNUP_STEPS[3]}</Headline>
      <IdentityChecks done={<Button primary label={IDENTITY_WORDS.open} onPress={() => router.replace('/')} />} />
    </Screen>
  )
}
