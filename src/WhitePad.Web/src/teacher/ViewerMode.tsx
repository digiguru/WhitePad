import type { ClassroomConnection as HubConnection } from '../services/connection';
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QuestionChanged, Student } from '../shared/types/messages';
import StudentGrid from './StudentGrid';
import { HubEvents, HubMethods } from '../shared/constants/hubContract';
import ConfidenceSummary from './ConfidenceSummary';
import { TeacherBoardStates } from './teacherBoardState';

interface ViewerModeProps {
  roomName: string;
  roomId: string;
  joinUrl: string;
  students: Student[];
  boards: TeacherBoardStates;
  connection: HubConnection | null;
  onSwitchToJoin: () => void;
}

function ViewerMode({ roomName, roomId, joinUrl, students, boards, connection, onSwitchToJoin }: ViewerModeProps) {
  const [focusedStudentId, setFocusedStudentId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [questionDraft, setQuestionDraft] = useState('');
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [didUpdateQuestion, setDidUpdateQuestion] = useState(false);
  const updateTimeoutRef = useRef<number | null>(null);
  const currentQuestionRef = useRef<string | null>(null);
  const QUESTION_MAX_LENGTH = 280;
  const totalStudents = students.length;
  const answeredCount = students.filter(student => student.hasAnswered).length;
  const answeredPercent = totalStudents === 0
    ? 0
    : Math.round((answeredCount / totalStudents) * 100);

  const handleLockAll = async () => {
    if (!connection) return;
    try {
      await connection.invoke(HubMethods.LockAllStudents, roomId);
    } catch (err) {
      console.error('Failed to lock all students:', err);
    }
  };

  const handleUnlockAll = async () => {
    if (!connection) return;
    try {
      await connection.invoke(HubMethods.UnlockAllStudents, roomId);
    } catch (err) {
      console.error('Failed to unlock all students:', err);
    }
  };

  const handleClearAll = async () => {
    if (!connection) return;
    if (!confirm('Clear all student boards? This cannot be undone.')) return;
    try {
      await connection.invoke(HubMethods.ClearAllBoards, roomId);
    } catch (err) {
      console.error('Failed to clear all boards:', err);
    }
  };

  useEffect(() => {
    if (!focusedStudentId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFocusedStudentId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedStudentId]);

  useEffect(() => {
    if (!focusedStudentId) return;
    const stillPresent = students.some(student => student.studentId === focusedStudentId);
    if (!stillPresent) {
      setFocusedStudentId(null);
    }
  }, [focusedStudentId, students]);

  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    if (!connection) return;

    const handleQuestionChanged = (message: QuestionChanged) => {
      const nextQuestion = message.question ?? null;
      setCurrentQuestion(nextQuestion);
      setQuestionDraft(prev => {
        const previousQuestion = currentQuestionRef.current ?? '';
        if (prev.trim() === '' || prev === previousQuestion) {
          return nextQuestion ?? '';
        }
        return prev;
      });
      setDidUpdateQuestion(true);
      if (updateTimeoutRef.current) {
        window.clearTimeout(updateTimeoutRef.current);
      }
      updateTimeoutRef.current = window.setTimeout(() => {
        setDidUpdateQuestion(false);
        updateTimeoutRef.current = null;
      }, 1400);
    };

    connection.on(HubEvents.QuestionChanged, handleQuestionChanged);
    return () => {
      connection.off(HubEvents.QuestionChanged, handleQuestionChanged);
    };
  }, [connection]);

  const invokeSetQuestion = async (question: string | null) => {
    if (!connection) return;

    try {
      await connection.invoke(HubMethods.SetQuestion, roomId, question);
      return;
    } catch (err) {
      console.warn('SetQuestion(roomId, question) failed, retrying legacy signature:', err);
    }

    try {
      await connection.invoke(HubMethods.SetQuestion, question);
    } catch (err) {
      console.error('Failed to set question:', err);
      alert('Failed to send question. Please refresh and try again.');
    }
  };

  const handleSendQuestion = async () => {
    if (!connection) return;
    const trimmed = questionDraft.trim();
    const payload = trimmed.length === 0 ? null : trimmed;
    await invokeSetQuestion(payload);
  };

  const handleClearQuestion = async () => {
    if (!connection) return;
    setQuestionDraft('');
    await invokeSetQuestion(null);
  };

  const openQuestionModal = () => {
    setQuestionDraft(currentQuestion ?? '');
    setIsQuestionModalOpen(true);
  };

  const closeQuestionModal = () => {
    setIsQuestionModalOpen(false);
  };

  return (
    <div className="viewer-mode-container">
      <div className="viewer-mode-header">
        <div className="viewer-mode-title">
          <h1>{roomName}</h1>
          <p className="student-count">Students Connected: {students.length}</p>
        </div>

        <ConfidenceSummary students={students} />

        <div className="viewer-mode-qr" aria-label="Student join QR code">
          <QRCodeSVG
            value={joinUrl}
            size={86}
            level="M"
            includeMargin={true}
          />
        </div>

        <div className="viewer-mode-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onSwitchToJoin}
          >
            Back to Join Mode
          </button>
        </div>
      </div>

      <StudentGrid
        students={students}
        boards={boards}
        connection={connection}
        roomId={roomId}
        focusedStudentId={focusedStudentId}
        onFocusStudent={setFocusedStudentId}
        onExitFocus={() => setFocusedStudentId(null)}
      />

      <div className="classroom-controls">
        <h3>Classroom Controls</h3>
        <div className="control-buttons">
          <button type="button" className="button secondary" onClick={handleLockAll}>
            🔒 Lock All Students
          </button>
          <button type="button" className="button secondary" onClick={handleUnlockAll}>
            🔓 Unlock All Students
          </button>
          <button type="button" className="button danger" onClick={handleClearAll}>
            🗑️ Clear All Boards
          </button>
          <button type="button" className="button secondary" onClick={openQuestionModal}>
            Ask a Question
          </button>
        </div>
        <div className="question-status">
          <span className="question-status-metric">
            Answered: {answeredPercent}% ({answeredCount}/{totalStudents})
          </span>
          <span className="question-status-label">Question:</span>
          <span className="question-status-text">
            {currentQuestion && currentQuestion.trim().length > 0 ? currentQuestion : 'No question set'}
          </span>
        </div>
      </div>

      {isQuestionModalOpen && (
        <div className="modal-overlay" onClick={closeQuestionModal}>
          <div className="modal-content question-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Class Question</h2>
              <button type="button" className="modal-close" onClick={closeQuestionModal}>x</button>
            </div>
            <div className="modal-body">
              <div className="question-textarea-wrapper">
                <textarea
                  className="question-textarea"
                  value={questionDraft}
                  onChange={(e) => setQuestionDraft(e.target.value)}
                  placeholder="Type a question for the class..."
                  maxLength={QUESTION_MAX_LENGTH}
                  rows={4}
                />
                <span className="question-limit-overlay">
                  {questionDraft.length}/{QUESTION_MAX_LENGTH}
                </span>
              </div>
              <div className="question-actions">
                <div className="question-buttons">
                  <button
                    type="button"
                    className={`button secondary question-send-btn ${didUpdateQuestion ? 'sent' : ''}`}
                    onClick={handleSendQuestion}
                  >
                    Send / Update
                    {didUpdateQuestion && <span className="question-send-tick">✓</span>}
                  </button>
                  <button type="button" className="button danger" onClick={handleClearQuestion}>
                    Clear Question
                  </button>
                </div>
              </div>
              <p className="question-modal-hint">Click outside the box to close.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ViewerMode;











