import { IdentityChecks } from '@/components/identity-checks'
import { Back, Button, Headline } from '@/components/ui'
import { IDENTITY_WORDS, SIGNUP_STEPS } from '@/signup-words'
import { router } from 'expo-router'

// B61.21 — /settings/verification, the web's Settings → Verification (suite B61.20): the identity check outside sign-up,
// where Home's "Finish confirming who you are" leads. B57.174: the same screen as sign-up's step 4, Pocket Live's su5.

/** B65.3 — back from the identity partner's page with a pass, the app goes on to Home. */
const toHome = () => router.replace('/')

export default function VerificationScreen() {
  return (
    <IdentityChecks
      head={
        <>
          <Back home="/settings" />
          <Headline>{SIGNUP_STEPS[3]}</Headline>
        </>
      }
      done={<Button primary label={IDENTITY_WORDS.open} onPress={() => router.replace('/')} />}
      onPassed={toHome}
    />
  )
}
