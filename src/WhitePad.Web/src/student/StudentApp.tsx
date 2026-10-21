import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { JoinRoomResponse } from '../shared/types/messages';
import { HubMethods } from '../shared/constants/hubContract';
import JoinPage from './JoinPage';
import DrawingPage from './DrawingPage';
import { useStudentConnection } from './hooks/useStudentConnection';

type StudentSession = {
  studentId: string;
  studentSessionToken: string;
  displayName: string;
  isLocked: boolean;
  currentQuestion: string | null;
};

type StoredStudentSession = {
  roomId: string;
  joinToken: string;
  studentSessionToken: string;
};

const storageKey = (roomId: string) => `whitepad.studentSession.${roomId}`;

function readStoredSession(roomId: string, joinToken: string): StoredStudentSession | null {
  try {
    const raw = window.localStorage.getItem(storageKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredStudentSession;
    if (parsed.roomId !== roomId || parsed.joinToken !== joinToken || !parsed.studentSessionToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(roomId: string, joinToken: string, studentSessionToken: string) {
  try {
    window.localStorage.setItem(storageKey(roomId), JSON.stringify({
      roomId,
      joinToken,
      studentSessionToken,
    } satisfies StoredStudentSession));
  } catch {
    // Storage can be unavailable in private/restricted browser modes.
  }
}

function clearStoredSession(roomId: string) {
  try {
    window.localStorage.removeItem(storageKey(roomId));
  } catch {
    // Ignore storage failures.
  }
}

function StudentApp() {
  const [searchParams] = useSearchParams();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [initialIsLocked, setInitialIsLocked] = useState(false);
  const [initialQuestion, setInitialQuestion] = useState<string | null>(null);
  const [showKickedModal, setShowKickedModal] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [hasAttemptedResume, setHasAttemptedResume] = useState(false);

  const roomId = searchParams.get('roomId');
  const joinToken = searchParams.get('token');

  const handleJoined = useCallback((session: StudentSession) => {
    setStudentId(session.studentId);
    setDisplayName(session.displayName);
    setInitialIsLocked(session.isLocked);
    setInitialQuestion(session.currentQuestion);
    if (roomId && joinToken) {
      writeStoredSession(roomId, joinToken, session.studentSessionToken);
    }
  }, [joinToken, roomId]);

  const handleKickedModalClose = () => {
    setShowKickedModal(false);
    setStudentId(null);
    setDisplayName(null);
    setInitialIsLocked(false);
    setInitialQuestion(null);
    if (roomId) {
      clearStoredSession(roomId);
    }
  };

  // Stable callback for kicked event
  const handleKicked = useCallback(() => {
    // Show kicked modal
    setShowKickedModal(true);
  }, []);

  const { connection, error } = useStudentConnection(handleKicked);

  useEffect(() => {
    setHasAttemptedResume(false);
    setStudentId(null);
    setDisplayName(null);
    setInitialIsLocked(false);
    setInitialQuestion(null);
  }, [roomId, joinToken]);

  useEffect(() => {
    if (!roomId || !joinToken || !connection || studentId || hasAttemptedResume) return;

    const stored = readStoredSession(roomId, joinToken);
    if (!stored) {
      setHasAttemptedResume(true);
      return;
    }

    let isCancelled = false;

    const resume = async () => {
      try {
        const response: JoinRoomResponse = await connection.invoke(
          HubMethods.ResumeStudentSession,
          roomId,
          joinToken,
          stored.studentSessionToken
        );

        if (isCancelled) return;

        if (!response.success || !response.studentId || !response.displayName || !response.studentSessionToken) {
          clearStoredSession(roomId);
          setHasAttemptedResume(true);
          return;
        }

        handleJoined({
          studentId: response.studentId,
          studentSessionToken: response.studentSessionToken,
          displayName: response.displayName,
          isLocked: response.isLocked ?? false,
          currentQuestion: response.currentQuestion ?? null,
        });
      } catch (err) {
        console.warn('Failed to resume student session:', err);
        if (connection.isPeer && !String(err).includes('(403)') && !String(err).includes('(404)')) {
          setResumeError('Your saved session is safe. The classroom service is unavailable.');
        } else { clearStoredSession(roomId); }
      } finally {
        if (!isCancelled) {
          setHasAttemptedResume(true);
        }
      }
    };

    resume();

    return () => {
      isCancelled = true;
    };
  }, [connection, handleJoined, hasAttemptedResume, joinToken, roomId, studentId]);

  if (!roomId || !joinToken) {
    return (
      <div className="error-message">
        Invalid join URL. Please use the link provided by your teacher.
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-message">
        {error}
      </div>
    );
  }

  if (!connection) {
    return <div className="join-container"><p>Connecting...</p></div>;
  }

  if (resumeError) return <div className="join-container"><p role="alert">{resumeError}</p><button onClick={() => { setResumeError(null); setHasAttemptedResume(false); }}>Retry connection</button></div>;

  if (!hasAttemptedResume && !studentId) {
    return <div className="join-container"><p>Reconnecting...</p></div>;
  }

  if (!studentId || !displayName) {
    return (
      <JoinPage
        roomId={roomId}
        joinToken={joinToken}
        connection={connection}
        onJoined={handleJoined}
      />
    );
  }

  return (
    <>
      <DrawingPage
        roomId={roomId}
        studentId={studentId}
        displayName={displayName}
        connection={connection}
        initialIsLocked={initialIsLocked}
        initialQuestion={initialQuestion}
      />

      {showKickedModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>You were kicked</h2>
            <p>The teacher has removed you from the session.</p>
            <button type="button" className="button primary" onClick={handleKickedModalClose}>
              Okay
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default StudentApp;
