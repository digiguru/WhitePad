import { useEffect, useRef, useState } from 'react';
import type { ClassroomConnection as HubConnection } from '../../services/connection';
import { createClassroomConnection } from '../../services/classroom';
import {
  ParticipantJoined,
  ParticipantLeft,
  Student,
  ConfidenceChanged,
  StudentLocked,
  AnsweredChanged,
  StrokeBatch,
  StrokeUndone,
  BoardCleared,
  ShapeDrawn,
} from '../../shared/types/messages';
import { HubEvents, HubMethods } from '../../shared/constants/hubContract';
import { readTeacherToken } from '../teacherTokenStore';
import {
  applyClearToBoard,
  applyShapeToBoard,
  applyStrokeBatchToBoard,
  applyUndoToBoard,
  emptyTeacherBoard,
  TeacherBoardStates,
  updateStudentBoard,
} from '../teacherBoardState';

type TeacherRoomConnectionState = {
  connection: HubConnection | null;
  students: Student[];
  boards: TeacherBoardStates;
  error: string | null;
};

export function useTeacherRoomConnection(roomId: string): TeacherRoomConnectionState {
  const [connection, setConnection] = useState<HubConnection | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [boards, setBoards] = useState<TeacherBoardStates>({});
  const [error, setError] = useState<string | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);

  useEffect(() => {
    let isDisposed = false;
    const conn = createClassroomConnection();
    let boardFlush: ReturnType<typeof setTimeout> | null = null;
    let pendingBoards: ((previous: TeacherBoardStates) => TeacherBoardStates)[] = [];
    const flushBoards = () => {
      if (boardFlush) clearTimeout(boardFlush);
      boardFlush = null;
      const updates = pendingBoards; pendingBoards = [];
      if (!isDisposed && updates.length) setBoards(previous => updates.reduce((state, update) => update(state), previous));
    };
    // Commit all arriving boards together, instead of rerendering the class for every peer batch.
    const updateBoards = (update: (previous: TeacherBoardStates) => TeacherBoardStates) => {
      if (!conn.isPeer) { setBoards(update); return; }
      pendingBoards.push(update);
      if (pendingBoards.length >= 512) flushBoards();
      else if (!boardFlush) boardFlush = setTimeout(flushBoards, 50);
    };

    setStudents([]);
    setBoards({});
    setConnection(null);
    setError(null);

    conn.on(HubEvents.ParticipantJoined, (data: ParticipantJoined) => {
      const student: Student = {
        studentId: data.studentId,
        displayName: data.displayName,
        connectedAt: data.connectedAt,
        inputMode: data.inputMode,
        isLocked: data.isLocked ?? false,
        hasAnswered: data.hasAnswered ?? false,
        confidenceLevel: data.confidenceLevel ?? 'none',
      };
      setStudents(prev => [
        ...prev.filter(existing => existing.studentId !== student.studentId),
        student
      ]);
      updateBoards(prev => (
        prev[data.studentId]
          ? { ...prev, [data.studentId]: emptyTeacherBoard() }
          : prev
      ));
    });

    conn.on(HubEvents.ParticipantLeft, (data: ParticipantLeft) => {
      setStudents(prev => prev.filter(s => s.studentId !== data.studentId));
      updateBoards(prev => {
        const { [data.studentId]: _removed, ...remaining } = prev;
        return remaining;
      });
    });

    conn.on('participantConnection', ({studentId, isConnected}) => {
      setStudents(prev => prev.some(s => s.studentId === studentId && s.isConnected !== isConnected) ? prev.map(s => s.studentId === studentId ? {...s,isConnected} : s) : prev);
    });

    conn.on('boardRecovered', ({ studentId, board }) => {
      updateBoards(prev => ({ ...prev, [studentId]: board }));
    });

    conn.on(HubEvents.ReceiveStrokeBatch, (batch: StrokeBatch) => {
      updateBoards(prev => updateStudentBoard(
        prev,
        batch.studentId,
        board => applyStrokeBatchToBoard(board, batch)
      ));
    });

    conn.on(HubEvents.StrokeUndone, (message: StrokeUndone) => {
      updateBoards(prev => updateStudentBoard(
        prev,
        message.studentId,
        board => applyUndoToBoard(board, message)
      ));
    });

    conn.on(HubEvents.BoardCleared, (message: BoardCleared) => {
      updateBoards(prev => updateStudentBoard(
        prev,
        message.studentId,
        board => applyClearToBoard(board, message)
      ));
    });

    conn.on(HubEvents.ReceiveShape, (shapeDrawn: ShapeDrawn) => {
      updateBoards(prev => updateStudentBoard(
        prev,
        shapeDrawn.studentId,
        board => applyShapeToBoard(board, shapeDrawn)
      ));
    });

    conn.on(HubEvents.ConfidenceChanged, (message: ConfidenceChanged) => {
      setStudents(prev =>
        prev.map(s =>
          s.studentId === message.studentId
            ? { ...s, confidenceLevel: message.confidenceLevel }
            : s
        )
      );
    });

    conn.on(HubEvents.StudentLocked, (message: StudentLocked) => {
      setStudents(prev =>
        prev.map(s =>
          s.studentId === message.studentId
            ? { ...s, isLocked: message.isLocked }
            : s
        )
      );
    });

    const handleAnsweredChanged = (message: AnsweredChanged) => {
      setStudents(prev =>
        prev.map(s =>
          s.studentId === message.studentId
            ? { ...s, hasAnswered: message.hasAnswered }
            : s
        )
      );
    };

    conn.on(HubEvents.AnsweredChanged, handleAnsweredChanged);
    // Safety: handle PascalCase event name as well.
    conn.on('AnsweredChanged', handleAnsweredChanged);

    const setupConnection = async () => {
      const teacherToken = readTeacherToken(roomId);
      if (!teacherToken) {
        console.error('No teacher token available for room', roomId);
        setError('This dashboard is no longer authorised. Create a new room.');
        return;
      }

      try {
        await conn.start();
        await conn.invoke(HubMethods.JoinRoomAsTeacher, roomId, teacherToken);

        if (isDisposed) {
          await conn.stop();
          return;
        }

        connectionRef.current = conn;
        setConnection(conn);
      } catch (err) {
        console.error('Failed to connect:', err);
        setError('Failed to connect to room');
      }
    };

    setupConnection();

    return () => {
      isDisposed = true;
      if (boardFlush) clearTimeout(boardFlush);
      pendingBoards = [];
      if (connectionRef.current) {
      connectionRef.current.stop();
      connectionRef.current = null;
    } else {
      conn.stop();
    }
    };
  }, [roomId]);

  return {
    connection,
    students,
    boards,
    error,
  };
}
