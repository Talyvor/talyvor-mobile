import type { BffClient } from '@talyvor/bff-client'

// Live Activities are iOS only (live-activity.ios.ts): Android and the web show held payments as notifications.
export async function syncLiveActivities(_client: BffClient) {}
export async function endLiveActivities() {}
export function useLiveActivities(_client: BffClient, _signedIn: boolean) {}
