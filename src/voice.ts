import { PorcupineManager } from '@picovoice/porcupine-react-native'
import type { BffClient } from '@talyvor/bff-client'
import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'

import { spoken } from './chat-commands'
import { config } from './config'
import { biometricName } from './keys'

// B40.16 — talking to Talyvor on the phone, under B40.12's rules: what the person says is transcribed and every answer
// spoken by Lens (B40.10, through the BFF), billed like any model call. Voice reads and prepares; nothing is paid until
// the person approves it with Face ID. There is no voiceprint: a voice is never a way to approve anything.

/** Set once the person has been told they are talking to an AI (EU AI Act art 50). */
const AI_NOTICE_KEY = 'talyvor.chat.voice-notice'

export const AI_NOTICE = `You’re talking to an AI. What you say is turned into text, an AI model answers, and a computer voice reads the answer aloud. Voice can read and prepare: nothing is paid until you approve it with ${biometricName}.`

/** True the first time the person talks: the screen shows AI_NOTICE, and the first answer starts by saying it. */
export const notToldYet = async () => (await SecureStore.getItemAsync(AI_NOTICE_KEY)) === null

let playing: AudioPlayer | null = null
let answers = 0

/** Says the words aloud through Lens — the first time, after saying that this is an AI. A new answer stops the one before. */
export async function sayAloud(client: BffClient, text: string): Promise<void> {
  const words = spoken(text)
  if (words === '') return
  const first = await notToldYet()
  const { audio, type } = await client.speech(first ? `You’re talking to an AI. ${words}` : words)
  await SecureStore.setItemAsync(AI_NOTICE_KEY, 'told')
  const file = new File(Paths.cache, `taly-answer-${++answers}.${type.includes('wav') ? 'wav' : type.includes('ogg') ? 'ogg' : 'mp3'}`)
  await file.write(new Uint8Array(audio))
  playing?.remove()
  playing = createAudioPlayer(file.uri)
  playing.play()
}

/** "Hey Taly" needs Talyvor's Picovoice access key and its trained keyword file; without both the switch is not offered.
 * shortcut: the keyword is a path Porcupine reads on the phone; ship the trained .ppn in the app once it exists. */
export const heyTalyAvailable = () => !!config.picovoiceKey && !!config.heyTalyKeyword

/** Listens on the phone for "Hey Taly" until the answer is called; nothing it hears leaves the phone. */
export async function listenForHeyTaly(onWake: () => void): Promise<() => Promise<void>> {
  const manager = await PorcupineManager.fromKeywordPaths(config.picovoiceKey, [config.heyTalyKeyword], () => onWake())
  await manager.start()
  return async () => {
    await manager.stop()
    manager.delete()
  }
}
