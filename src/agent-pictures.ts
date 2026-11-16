import type { ImageSourcePropType } from 'react-native'

import { AGENT_KINDS } from './agent-kinds'
import type { FaceColour } from './components/face'

// B61.103 — the gallery an agent's picture is chosen from, as the web's (talyvor-suite B61.102, cards/agentPictures.ts):
// the six helpers' faces under the ids of their colours, lime's plain face, then the twenty B61.36 added (Lens B61.101,
// economy.AgentPictures). Each picture's colour is the one Lens gives it, so the agent's colour follows its picture. No
// picture carries a name: the agent keeps its owner's. The twenty are 216 px squares round the head and what it holds,
// cut from design/agent-pictures (the art cropped from the bottom to 1536:968): a face is drawn at 72 points at most.

export interface AgentPicture {
  /** Lens's picture id */
  id: string
  colour: FaceColour
  /** the art, or null for a face drawn in its colour */
  art: ImageSourcePropType | null
}

const face = (colour: FaceColour): AgentPicture => ({ id: colour, colour, art: null })

/** The twenty of B61.36, each in its colour from pictures.json. */
export const NEW_PICTURES: readonly AgentPicture[] = [
  { id: 'shopper', colour: 'lime', art: require('../assets/agent-pictures/shopper.jpg') },
  { id: 'grocer', colour: 'mint', art: require('../assets/agent-pictures/grocer.jpg') },
  { id: 'bills', colour: 'sky', art: require('../assets/agent-pictures/bills.jpg') },
  { id: 'saver', colour: 'rose', art: require('../assets/agent-pictures/saver.jpg') },
  { id: 'coder', colour: 'cobalt', art: require('../assets/agent-pictures/coder.jpg') },
  { id: 'designer', colour: 'orchid', art: require('../assets/agent-pictures/designer.jpg') },
  { id: 'writer', colour: 'lemon', art: require('../assets/agent-pictures/writer.jpg') },
  { id: 'social', colour: 'rose', art: require('../assets/agent-pictures/social.jpg') },
  { id: 'recruiter', colour: 'sky', art: require('../assets/agent-pictures/recruiter.jpg') },
  { id: 'legal', colour: 'cobalt', art: require('../assets/agent-pictures/legal.jpg') },
  { id: 'analyst', colour: 'mint', art: require('../assets/agent-pictures/analyst.jpg') },
  { id: 'events', colour: 'orchid', art: require('../assets/agent-pictures/events.jpg') },
  { id: 'chef', colour: 'lemon', art: require('../assets/agent-pictures/chef.jpg') },
  { id: 'coach', colour: 'lime', art: require('../assets/agent-pictures/coach.jpg') },
  { id: 'home', colour: 'rose', art: require('../assets/agent-pictures/home.jpg') },
  { id: 'driver', colour: 'sky', art: require('../assets/agent-pictures/driver.jpg') },
  { id: 'tutor', colour: 'cobalt', art: require('../assets/agent-pictures/tutor.jpg') },
  { id: 'musician', colour: 'orchid', art: require('../assets/agent-pictures/musician.jpg') },
  { id: 'photographer', colour: 'lemon', art: require('../assets/agent-pictures/photographer.jpg') },
  { id: 'gardener', colour: 'lime', art: require('../assets/agent-pictures/gardener.jpg') },
]

export const AGENT_PICTURES: readonly AgentPicture[] = [...AGENT_KINDS.map((k) => face(k.colour)), face('lime'), ...NEW_PICTURES]

/** The drawn picture an agent wears, when Lens names one of the twenty; null draws its colour's face. */
export const artOf = (picture?: string): ImageSourcePropType | null => NEW_PICTURES.find((p) => p.id === picture)?.art ?? null

/** What New agent sends for a picture: its colour, and one of the twenty by its id. The colour is the picture's own, so
 * Lens takes both, and a BFF that does not relay the picture yet still gives the agent the picture's colour. */
export const lookFor = (p: AgentPicture): { colour: FaceColour; picture?: string } => (p.art ? { colour: p.colour, picture: p.id } : { colour: p.colour })
