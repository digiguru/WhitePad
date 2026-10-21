import { useState, useEffect } from 'react';
import JoinMode from './JoinMode';
import ViewerMode from './ViewerMode';
import { useTeacherRoomConnection } from './hooks/useTeacherRoomConnection';

interface RoomDashboardProps {
  roomId: string;
  roomName: string;
  joinToken: string;
  joinUrl: string;
}

type ViewMode = 'join' | 'viewer';

function RoomDashboard({ roomId, roomName, joinToken, joinUrl }: RoomDashboardProps) {
  const { connection, students, boards, error } = useTeacherRoomConnection(roomId);
  const [transportStatus, setTransportStatus] = useState('');
  useEffect(() => {
    if(!connection) return;
    const changed = ({status}: {status: string}) => setTransportStatus(status);
    connection.on('transportStatus', changed);
    return () => connection.off('transportStatus', changed);
  }, [connection]);
  const [viewMode, setViewMode] = useState<ViewMode>('join');

  if (error) {
    return (
      <div className="dashboard-container">
        <p className="error-message">{error}</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {transportStatus && <div className="transport-status" role="status">{transportStatus}</div>}
      {viewMode === 'join' && (
        <JoinMode
          roomName={roomName}
          joinToken={joinToken}
          joinUrl={joinUrl}
          students={students}
          onSwitchToViewer={() => setViewMode('viewer')}
        />
      )}
      {viewMode === 'viewer' && (
        <ViewerMode
          roomName={roomName}
          roomId={roomId}
          joinUrl={joinUrl}
          students={students}
          boards={boards}
          connection={connection}
          onSwitchToJoin={() => setViewMode('join')}
        />
      )}
    </div>
  );
}

export default RoomDashboard;
