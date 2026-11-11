// B57.64 — the keychain in pocket-shots' web export (metro.config.js swaps it in): the sample's session, nothing kept.
if (process.env.EXPO_PUBLIC_BFF_URL !== 'https://bff.pocket-shots.invalid') throw new Error('the pocket-shots keychain loads only against the shots BFF')

const SESSION = JSON.stringify({ token: 'pocket-shots', expires_at: '2099-01-01T00:00:00Z' })

export async function getItemAsync(key) {
  return key === 'talyvor.session' ? SESSION : null
}
export async function setItemAsync() {}
export async function deleteItemAsync() {}
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
