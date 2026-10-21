import { useState, useRef } from 'react';
import type { ClassroomConnection as HubConnection } from '../services/connection';
import { JoinRoomResponse } from '../shared/types/messages';
import { HubMethods } from '../shared/constants/hubContract';

interface JoinPageProps {
  roomId: string;
  joinToken: string;
  connection: HubConnection;
  onJoined: (session: {
    studentId: string;
    studentSessionToken: string;
    displayName: string;
    isLocked: boolean;
    currentQuestion: string | null;
  }) => void;
}

function JoinPage({ roomId, joinToken, connection, onJoined }: JoinPageProps) {
  const [name, setName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasJoinedRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    if (hasJoinedRef.current) return; // Prevent duplicate joins

    try {
      hasJoinedRef.current = true;
      setIsJoining(true);
      setError(null);

      const response: JoinRoomResponse = await connection.invoke(
        HubMethods.JoinRoomAsStudent,
        roomId,
        joinToken,
        name.trim()
      );

      if (!response.success) {
        setError(response.error || 'Failed to join room');
        hasJoinedRef.current = false;
        setIsJoining(false);
        return;
      }

      onJoined({
        studentId: response.studentId!,
        studentSessionToken: response.studentSessionToken!,
        displayName: response.displayName!,
        isLocked: response.isLocked ?? false,
        currentQuestion: response.currentQuestion ?? null,
      });
    } catch (err) {
      console.error('Failed to join room:', err);
      setError('Failed to join room. Please check the link and try again.');
      hasJoinedRef.current = false;
      setIsJoining(false);
    }
  };

  return (
    <div className="join-container">
      <div className="name-modal">
        <h2>Welcome to WhitePad!</h2>
        <p>Please enter your name to join the session</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            className="name-input"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isJoining}
            autoFocus
            maxLength={50}
          />
          {error && <p className="error-message">{error}</p>}
          <button
            type="submit"
            className="button primary"
            disabled={isJoining || !name.trim()}
          >
            {isJoining ? 'Joining...' : 'Join Session'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default JoinPage;
