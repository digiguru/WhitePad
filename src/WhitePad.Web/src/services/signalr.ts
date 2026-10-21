import * as signalR from '@microsoft/signalr';

import type { ClassroomConnection } from './connection';
import { PeerClassroomConnection } from '../p2p/connection';

export function createSignalRConnection(hubUrl: string): ClassroomConnection {
  if (import.meta.env.VITE_TRANSPORT === 'webrtc') return new PeerClassroomConnection();
  return new signalR.HubConnectionBuilder()
    .withUrl(hubUrl)
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Information)
    .build();
}
