import { useState } from 'react';
import RoomCreatePage from './RoomCreatePage';
import RoomDashboard from './RoomDashboard';

type TeacherSession = {
  roomId: string;
  roomName: string;
  joinToken: string;
  joinUrl: string;
};

function TeacherApp() {
  const [session, setSession] = useState<TeacherSession | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('whitepad:teacherRoom:v1') ?? 'null');
      return saved?.expires > Date.now() ? saved.session : null;
    } catch { return null; }
  });

  if (!session) {
    return <RoomCreatePage onRoomCreated={(id, name, token, url) => {
      const next = { roomId: id, roomName: name, joinToken: token, joinUrl: url };
      try { sessionStorage.setItem('whitepad:teacherRoom:v1', JSON.stringify({ session: next, expires: Date.now() + 86400000 })); } catch { /* Session remains usable until refresh. */ }
      setSession(next);
    }} />;
  }

  return (
    <RoomDashboard
      roomId={session.roomId}
      roomName={session.roomName}
      joinToken={session.joinToken}
      joinUrl={session.joinUrl}
    />
  );
}

export default TeacherApp;
