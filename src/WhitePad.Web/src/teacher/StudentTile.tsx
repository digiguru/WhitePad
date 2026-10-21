import { useRef, useEffect, useState, useCallback, memo } from 'react';
import type { ClassroomConnection as HubConnection } from '../services/connection';
import { Student, PaperColor } from '../shared/types/messages';
import { renderBoardCanvas, invalidateBoardCanvas } from './boardRenderer';
import { HubMethods } from '../shared/constants/hubContract';
import { EMPTY_TEACHER_BOARD, TeacherBoardState } from './teacherBoardState';

interface StudentTileProps {
  student: Student;
  boardState?: TeacherBoardState;
  connection: HubConnection | null;
  roomId: string;
  isFocused?: boolean;
  isFocusActive?: boolean;
  onRequestFocus?: (studentId: string) => void;
  onExitFocus?: () => void;
}

interface ContextMenuPosition {
  x: number;
  y: number;
}

const PAPER_COLORS: Record<PaperColor, string> = {
  white: '#FFFFFF',
  buff: '#F4E4BC',
};

const BACKGROUND_MARK_COLORS: Record<PaperColor, { stroke: string; dot: string }> = {
  white: { stroke: '#e5e5e5', dot: '#d0d0d0' },
  buff: { stroke: '#c7a763', dot: '#b8944b' },
};

function StudentTile({
  student,
  boardState = EMPTY_TEACHER_BOARD,
  connection,
  roomId,
  isFocused = false,
  isFocusActive = false,
  onRequestFocus,
  onExitFocus,
}: StudentTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestBoard = useRef(boardState);
  latestBoard.current = boardState;
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const paperColor = PAPER_COLORS[boardState.paperColor];
    ctx.fillStyle = paperColor;
    ctx.fillRect(0, 0, width, height);

    if (boardState.backgroundType === 'none') {
      return;
    }

    ctx.save();
    const markColor = BACKGROUND_MARK_COLORS[boardState.paperColor];
    ctx.strokeStyle = markColor.stroke;
    ctx.lineWidth = 0.5;

    const spacing = 35;
    switch (boardState.backgroundType) {
      case 'dotted':
        ctx.fillStyle = markColor.dot;
        for (let x = spacing; x < width; x += spacing) {
          for (let y = spacing; y < height; y += spacing) {
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      case 'lined':
        for (let y = spacing; y < height; y += spacing) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        break;
      case 'squares':
        for (let x = spacing; x < width; x += spacing) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = spacing; y < height; y += spacing) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        break;
    }

    ctx.restore();
  }, [boardState.backgroundType, boardState.paperColor]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) renderBoardCanvas(canvas, latestBoard.current, isFocused ? 1 : 0.4, drawBackground);
  }, [drawBackground, isFocused]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const handleRequestFocus = () => {
    if (!onRequestFocus) return;
    onRequestFocus(student.studentId);
    setContextMenu(null);
  };

  const handleExitFocus = () => {
    if (!onExitFocus) return;
    onExitFocus();
    setContextMenu(null);
  };

  const handleLockToggle = async () => {
    if (!connection) return;

    try {
      if (student.isLocked) {
        await connection.invoke(HubMethods.UnlockStudent, roomId, student.studentId);
      } else {
        await connection.invoke(HubMethods.LockStudent, roomId, student.studentId);
      }
    } catch (err) {
      console.error('Failed to toggle lock:', err);
    }
    setContextMenu(null);
  };

  const handleKick = async () => {
    if (!connection) return;

    try {
      await connection.invoke(HubMethods.KickStudent, roomId, student.studentId);
    } catch (err) {
      console.error('Failed to kick student:', err);
    }
    setContextMenu(null);
  };

  const handleClear = async () => {
    if (!connection) return;

    if (!confirm(`Clear ${student.displayName}'s board? This cannot be undone.`)) {
      setContextMenu(null);
      return;
    }

    try {
      await connection.invoke(HubMethods.ClearStudentBoard, roomId, student.studentId);
    } catch (err) {
      console.error('Failed to clear student board:', err);
    }
    setContextMenu(null);
  };

  const handleResizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!canvas || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const availableWidth = Math.max(1, Math.floor(rect.width));
    const availableHeight = Math.max(1, Math.floor(rect.height));
    const aspectRatio = 4 / 3;

    let width = availableWidth;
    let height = Math.floor(width / aspectRatio);
    if (height > availableHeight) {
      height = availableHeight;
      width = Math.floor(height * aspectRatio);
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      redrawCanvas();
    }
  }, [redrawCanvas]);

  // Close context menu when clicking anywhere
  useEffect(() => {
    if (contextMenu) {
      const handleClick = () => handleCloseContextMenu();
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    handleResizeCanvas();

    if (typeof ResizeObserver === 'undefined') {
      const handleWindowResize = () => handleResizeCanvas();
      window.addEventListener('resize', handleWindowResize);
      return () => window.removeEventListener('resize', handleWindowResize);
    }

    const observer = new ResizeObserver(() => handleResizeCanvas());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [handleResizeCanvas, isFocused]);

  useEffect(() => {
    redrawCanvas();
  }, [boardState, redrawCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const restored = () => { invalidateBoardCanvas(canvas); redrawCanvas(); };
    canvas.addEventListener('contextrestored', restored);
    return () => canvas.removeEventListener('contextrestored', restored);
  }, [redrawCanvas]);

  return (
    <>
      <div
        className={`student-tile ${student.isLocked ? 'locked' : ''} ${isFocused ? 'focused' : ''} ${isFocusActive && !isFocused ? 'hidden' : ''}`}
        onContextMenu={handleContextMenu}
        onDoubleClick={() => {
          if (!isFocused) handleRequestFocus();
        }}
      >
        {isFocused && (
          <div className="focus-controls">
            <button
              type="button"
              className="button secondary"
              onClick={handleExitFocus}
            >
              Back to Class View
            </button>
            <div className="focus-controls-actions">
              <button
                type="button"
                className="button secondary"
                onClick={handleLockToggle}
              >
                {student.isLocked ? 'Unlock' : 'Lock'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={handleClear}
              >
                Clear Board
              </button>
              <button
                type="button"
                className="button danger"
                onClick={handleKick}
              >
                Kick
              </button>
            </div>
          </div>
        )}
        <div className="student-tile-header">
          {student.isLocked && '🔒 '}{student.displayName}{student.isConnected === false && <small> (disconnected)</small>}
        </div>
        <div className="student-canvas-wrapper" ref={canvasWrapperRef}>
          <canvas
            ref={canvasRef}
            className="student-canvas"
            width={200}
            height={150}
          />
        </div>
        {student.confidenceLevel && student.confidenceLevel !== 'none' && (
          <div
            className={`confidence-indicator ${student.confidenceLevel}`}
            title={`Confidence: ${student.confidenceLevel}`}
          />
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={isFocused ? handleExitFocus : handleRequestFocus}
          >
            {isFocused ? 'Back to Class View' : 'Focus Student'}
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={handleLockToggle}
          >
            {student.isLocked ? 'Unlock' : 'Lock'}
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={handleClear}
          >
            Clear Board
          </button>
          <button
            type="button"
            className="context-menu-item kick"
            onClick={handleKick}
          >
            Kick
          </button>
        </div>
      )}
    </>
  );
}

export default memo(StudentTile);
