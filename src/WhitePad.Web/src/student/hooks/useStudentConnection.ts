import { useEffect, useState } from 'react';
import type { ClassroomConnection as HubConnection } from '../../services/connection';
import { createSignalRConnection } from '../../services/signalr';
import { HubEvents } from '../../shared/constants/hubContract';

type StudentConnectionState = {
  connection: HubConnection | null;
  error: string | null;
};

export function useStudentConnection(onKicked: () => void): StudentConnectionState {
  const [connection, setConnection] = useState<HubConnection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isDisposed = false;
    const conn = createSignalRConnection('/hub/whiteboard');

    const setupConnection = async () => {
      try {
        await conn.start();
        conn.on(HubEvents.Kicked, onKicked);

        if (isDisposed) {
          await conn.stop();
          return;
        }

        setConnection(conn);
      } catch (err) {
        console.error('Failed to connect:', err);
        setError('Failed to connect to room');
      }
    };

    setupConnection();

    return () => {
      isDisposed = true;
      conn.off(HubEvents.Kicked, onKicked);
      conn.stop();
    };
  }, [onKicked]);

  return { connection, error };
}
