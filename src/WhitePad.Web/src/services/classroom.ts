import type { ClassroomConnection } from './connection';
import { PeerClassroomConnection } from '../p2p/connection';
export function createClassroomConnection(): ClassroomConnection {
  return new PeerClassroomConnection();
}
