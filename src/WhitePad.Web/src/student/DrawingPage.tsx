import { useRef, useEffect, useState, useCallback } from 'react';
import type { ClassroomConnection as HubConnection } from '../services/connection';
import { StrokeBatcher } from '../shared/utils/strokeBatching';
import { StrokePoint, StrokeBatch, Shape, QuestionChanged, BackgroundType, PaperColor } from '../shared/types/messages';
import { renderShape } from '../shared/utils/shapeRenderer';
import { debugLog } from '../shared/utils/debugLog';
import { HubEvents, HubMethods } from '../shared/constants/hubContract';
import Toolbar, { ToolType } from './Toolbar';
import { CheckIcon } from './icons';
import { useStrokeHistory } from './hooks/useStrokeHistory';
import { useStudentLockState } from './hooks/useStudentLockState';
import { useLatest } from '../shared/hooks/useLatest';

interface DrawingPageProps {
  roomId: string;
  studentId: string;
  displayName: string;
  connection: HubConnection;
  initialIsLocked?: boolean;
  initialQuestion?: string | null;
}

interface StoredStroke {
  strokeId: string;
  batches: StrokeBatch[];
  color: string;
  lineWidth: number;
  isEraser: boolean;
}

const ERASER_COLOR_SENTINEL = '__WHITEPAD_ERASER__';
const PAPER_COLORS: Record<PaperColor, string> = {
  white: '#FFFFFF',
  buff: '#F4E4BC',
};

const BACKGROUND_MARK_COLORS: Record<PaperColor, { stroke: string; dot: string }> = {
  white: { stroke: '#e5e5e5', dot: '#d0d0d0' },
  buff: { stroke: '#c7a763', dot: '#b8944b' },
};

function DrawingPage({
  studentId,
  displayName,
  connection,
  roomId: _roomId,
  initialIsLocked = false,
  initialQuestion = null,
}: DrawingPageProps) {

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const batcherRef = useRef<StrokeBatcher | null>(null);
  const currentStrokeIdRef = useRef<string | null>(null);
  const isDrawingRef = useRef(false);
  const pointerDownInProgressRef = useRef(false); // Prevent re-entrancy
  const activePointerIdRef = useRef<number | null>(null);

  const [recovered] = useState(() => connection.recoveredBoard?.());
  const [boardFull, setBoardFull] = useState(false);
  const boardFullRef = useLatest(boardFull);
  const [transportStatus, setTransportStatus] = useState('');
  // Drawing state
  const [currentColor, setCurrentColor] = useState('#000000');
  const [currentThickness, setCurrentThickness] = useState(2);
  const [currentTool, setCurrentTool] = useState<ToolType>('pen');
  const [currentBackground, setCurrentBackground] = useState<BackgroundType>(recovered?.backgroundType ?? 'none');
  const [currentPaperColor, setCurrentPaperColor] = useState<PaperColor>(recovered?.paperColor ?? 'white');
  const [confidenceLevel, setConfidenceLevel] = useState<'none' | 'red' | 'amber' | 'green'>(() => connection.recoveredIndicators?.().confidence ?? 'none');
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(initialQuestion);
  const [hasAnswered, setHasAnswered] = useState(() => connection.recoveredIndicators?.().answered ?? false);

  const {
    isLocked,
  } = useStudentLockState({
    connection,
    studentId,
    initialIsLocked,
  });

  const isClassroomLocked = isLocked;

  // Undo/redo state
  const strokesRef = useRef<Map<string, StoredStroke>>(new Map());
  const {
    strokeHistory,
    setStrokeHistory,
    strokeHistoryRef,
    undoneStrokes,
    setUndoneStrokes,
  } = useStrokeHistory();
  const currentBackgroundRef = useLatest<BackgroundType>(currentBackground);
  const currentPaperColorRef = useLatest<PaperColor>(currentPaperColor);

  // Cursor state for eraser
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);

  // Shape state
  const shapesRef = useRef<Map<string, Shape>>(new Map());
  const [shapeInProgress, setShapeInProgress] = useState<Shape | null>(null);

  // Create refs for pointer handler dependencies to stabilize them
  const currentColorRef = useLatest(currentColor);
  const currentThicknessRef = useLatest(currentThickness);
  const currentToolRef = useLatest(currentTool);
  const currentBackgroundInputRef = useLatest(currentBackground);
  const currentPaperColorInputRef = useLatest(currentPaperColor);
  const isLockedRef = useLatest(isLocked);
  const studentIdRef = useLatest(studentId);
  const connectionRef = useLatest(connection);

  // Redraw background canvas when background changes
  useEffect(() => {
    renderBackgroundCanvas();
  }, [currentBackground, currentPaperColor]);

  useEffect(() => {
    if (isLockedRef.current) return;

    connection.invoke(HubMethods.SendStrokeBatch, {
      studentId,
      strokeId: `${studentId}-background-${Date.now()}`,
      points: [],
      color: PAPER_COLORS[currentPaperColor],
      lineWidth: 0,
      backgroundType: currentBackground,
      paperColor: currentPaperColor,
      isEraser: false,
      isComplete: true,
    } satisfies StrokeBatch).catch(err => {
      console.error('Failed to send background update:', err);
    });
  }, [connection, currentBackground, currentPaperColor, studentId]);

  // Listen for teacher-initiated board clear
  useEffect(() => {
    const handleBoardCleared = (message: { studentId: string }) => {
      if (message.studentId === studentId) {
        batcherRef.current?.cancel();
      batcherRef.current = null;
        currentStrokeIdRef.current = null;
        isDrawingRef.current = false;
        activePointerIdRef.current = null;
        setShapeInProgress(null);
        setBoardFull(false);
        // Clear local state
        strokesRef.current.clear();
        shapesRef.current.clear();
        setStrokeHistory([]);
        setUndoneStrokes([]);

        // Clear canvas
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }
      }
    };

    connection.on(HubEvents.BoardCleared, handleBoardCleared);

    return () => {
      connection.off(HubEvents.BoardCleared, handleBoardCleared);
    };
  }, [connection, studentId]);

  // Listen for teacher question updates
  useEffect(() => {
    const handleQuestionChanged = (message: QuestionChanged & { isInitial?: boolean }) => {
      const next = message.question ?? null;
      if (!message.isInitial) setHasAnswered(false);
      setCurrentQuestion(next);
    };

    connection.on(HubEvents.QuestionChanged, handleQuestionChanged);
    return () => {
      connection.off(HubEvents.QuestionChanged, handleQuestionChanged);
    };
  }, [connection]);

  const handleAnsweredToggle = useCallback(() => {
    const nextValue = !hasAnswered;
    setHasAnswered(nextValue);
    connection.invoke(HubMethods.SetAnswered, nextValue).catch(err => {
      console.error('Failed to set answered state:', err);
    });
  }, [connection, hasAnswered]);

  // Manual resize handler that can be called when needed
  const handleCanvasResize = useRef(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Skip if currently drawing
    if (isDrawingRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const currentHistory = strokeHistoryRef.current;

    // Only resize if dimensions actually changed
    if (canvas.width === rect.width && canvas.height === rect.height) {
      return;
    }
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Also resize background canvas to match
    const backgroundCanvas = backgroundCanvasRef.current;
    if (backgroundCanvas) {
      backgroundCanvas.width = rect.width;
      backgroundCanvas.height = rect.height;
      // Redraw background on the background canvas
      const bgCtx = backgroundCanvas.getContext('2d');
      if (bgCtx) {
        drawBackground(
          bgCtx,
          backgroundCanvas.width,
          backgroundCanvas.height,
          currentBackgroundRef.current,
          currentPaperColorRef.current
        );
      }
    }

    // Get context and redraw manually using the ref
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    currentHistory.forEach(strokeId => {
      const stroke = strokesRef.current.get(strokeId);
      if (stroke) {
        ctx.globalCompositeOperation = stroke.isEraser ? 'destination-out' : 'source-over';
        ctx.strokeStyle = stroke.isEraser ? '#000000' : stroke.color;
        ctx.lineWidth = stroke.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const allPoints: StrokePoint[] = [];
        stroke.batches.forEach(batch => {
          allPoints.push(...batch.points);
        });

        if (allPoints.length === 0) return;

        ctx.beginPath();
        const firstPoint = allPoints[0];
        ctx.moveTo(firstPoint.x * canvas.width, firstPoint.y * canvas.height);

        for (let i = 1; i < allPoints.length; i++) {
          const point = allPoints[i];
          ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
        }

        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        return;
      }

      const shape = shapesRef.current.get(strokeId);
      if (shape) {
        renderShape(ctx, shape, canvas.width, canvas.height);
        return;
      }

      debugLog('DrawingPage', 'Resize redraw skipped missing item', strokeId);
    });
  });

  // Initial setup and window resize handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let resizeTimeout: number | null = null;

    // Initial resize
    handleCanvasResize.current();

    // Handle actual window resize (browser window size change)
    const handleWindowResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = window.setTimeout(() => {
        handleCanvasResize.current();
      }, 150);
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
    };
  }, []);

  // Initialize canvas when the board lock state changes.
  useEffect(() => {
    if (!isLocked && canvasRef.current) {
      // Small delay to ensure canvas is rendered in DOM
      setTimeout(() => {
        handleCanvasResize.current();
      }, 50);
    }
  }, [isLocked]);

  const redrawCanvas = useCallback((strokeIds?: string[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use provided strokeIds or current strokeHistory from ref
    const idsToRender = strokeIds !== undefined ? strokeIds : strokeHistoryRef.current;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Redraw all strokes and shapes in history order
    idsToRender.forEach(id => {
      // Try to find as stroke first
      const stroke = strokesRef.current.get(id);
      if (stroke) {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.lineWidth;
        ctx.globalCompositeOperation = stroke.isEraser ? 'destination-out' : 'source-over';
        if (stroke.isEraser) {
          ctx.strokeStyle = '#000000';
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw all points from all batches
        const allPoints: StrokePoint[] = [];
        stroke.batches.forEach(batch => {
          allPoints.push(...batch.points);
        });

        if (allPoints.length === 0) return;

        ctx.beginPath();
        const firstPoint = allPoints[0];
        ctx.moveTo(firstPoint.x * canvas.width, firstPoint.y * canvas.height);

        for (let i = 1; i < allPoints.length; i++) {
          const point = allPoints[i];
          ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
        }

        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        return;
      }

      // Try to find as shape
      const shape = shapesRef.current.get(id);
      if (shape) {
        renderShape(ctx, shape, canvas.width, canvas.height);
        return;
      }
    });
  }, []); // No dependencies - uses refs for all data

  const drawBackground = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    backgroundType: BackgroundType,
    paperColor: PaperColor
  ) => {
    ctx.save();
    ctx.fillStyle = PAPER_COLORS[paperColor];
    ctx.fillRect(0, 0, width, height);

    if (backgroundType === 'none') {
      ctx.restore();
      return;
    }

    const markColor = BACKGROUND_MARK_COLORS[paperColor];
    ctx.strokeStyle = markColor.stroke;
    ctx.lineWidth = 0.5;

    const spacing = 35; // ~35px spacing similar to notebook paper on iPad

    switch (backgroundType) {
      case 'dotted':
        // Draw dots in a grid
        for (let x = spacing; x < width; x += spacing) {
          for (let y = spacing; y < height; y += spacing) {
            ctx.fillStyle = markColor.dot;
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;

      case 'lined':
        // Draw horizontal lines like ruled paper
        for (let y = spacing; y < height; y += spacing) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        break;

      case 'squares':
        // Draw grid lines
        // Vertical lines
        for (let x = spacing; x < width; x += spacing) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        // Horizontal lines
        for (let y = spacing; y < height; y += spacing) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        break;
    }

    ctx.restore();
  };

  // Render background on separate background canvas
  const renderBackgroundCanvas = () => {
    const canvas = backgroundCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear the background canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw the background pattern
    drawBackground(ctx, canvas.width, canvas.height, currentBackground, currentPaperColor);
  };

  const getNormalizedPoint = (clientX: number, clientY: number, pressure: number): StrokePoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();

    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
      pressure,
    };
  };

  const drawPoint = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!isDrawingRef.current) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      isDrawingRef.current = true;
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const isAllowedInputPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'touch') return e.isPrimary;
    if (e.pointerType === 'mouse') return e.button === 0;
    return false;
  };

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // Prevent re-entrancy - if we're already processing a pointer down, ignore this one
    if (pointerDownInProgressRef.current) {
      return;
    }

    pointerDownInProgressRef.current = true;

    if (isLockedRef.current || boardFullRef.current) {
      pointerDownInProgressRef.current = false;
      return; // Prevent drawing when locked
    }

    if (!isAllowedInputPointer(e)) {
      pointerDownInProgressRef.current = false;
      return;
    }

    // Palm/multi-touch rejection: keep a single active pointer.
    if (activePointerIdRef.current !== null) {
      e.preventDefault();
      pointerDownInProgressRef.current = false;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      pointerDownInProgressRef.current = false;
      return;
    }

    activePointerIdRef.current = e.pointerId;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      activePointerIdRef.current = null;
      pointerDownInProgressRef.current = false;
      return;
    }

    const pressure = e.pressure || 0.5;
    const point = getNormalizedPoint(e.clientX, e.clientY, pressure);

    const tool = currentToolRef.current;
    const color = currentColorRef.current;
    const thickness = currentThicknessRef.current;
    const isEraser = tool === 'eraser';
    const backgroundType = currentBackgroundInputRef.current;
    const paperColor = currentPaperColorInputRef.current;
    const sid = studentIdRef.current;
    const conn = connectionRef.current;

    // Handle shape tools
    if (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow' || tool === 'axesL' || tool === 'axesCross') {
      const shapeId = `${sid}-shape-${Date.now()}`;
      const newShape: Shape = {
        shapeId,
        studentId: sid,
        type: tool,
        points: [point],
        color: color,
        lineWidth: thickness,
        backgroundType,
        paperColor,
        isComplete: false,
      };
      setShapeInProgress(newShape);
      pointerDownInProgressRef.current = false;
      return;
    }

    // Use destination-out composite mode for eraser to actually erase pixels
    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const strokeId = `${sid}-${isEraser ? 'eraser' : 'stroke'}-${Date.now()}`;
    currentStrokeIdRef.current = strokeId; // Store for later use in pointerUp

    // Store stroke for undo/redo
    const newStroke: StoredStroke = {
      strokeId,
      batches: [],
      color: isEraser ? ERASER_COLOR_SENTINEL : color,
      lineWidth: thickness,
      isEraser,
    };
    strokesRef.current.set(strokeId, newStroke);

    // DON'T update state during pointer down - defer to pointer up
    // This prevents re-renders during active pointer interaction
    // setStrokeHistory(prev => [...prev, strokeId]);
    // setUndoneStrokes([]); // Clear redo stack when new stroke is made

    batcherRef.current = new StrokeBatcher(strokeId, (batch) => {
      // Add color and lineWidth to the batch
      const batchWithStyle: StrokeBatch = {
        studentId: sid,
        strokeId: batch.strokeId || strokeId,
        points: batch.points || [],
        isComplete: batch.isComplete || false,
        color: isEraser ? ERASER_COLOR_SENTINEL : color,
        lineWidth: isEraser ? -thickness : thickness,
        backgroundType,
        paperColor,
        isEraser,
      };

      // Store batch locally
      const stroke = strokesRef.current.get(strokeId);
      if (stroke) {
        stroke.batches.push(batchWithStyle);
      }

      // Send to server
      conn.invoke(HubMethods.SendStrokeBatch, batchWithStyle).catch(err => {
        console.error('Failed to send stroke batch:', err);
      });
    });

    batcherRef.current.addPoint(point);
    drawPoint(e.clientX - canvas.getBoundingClientRect().left,
             e.clientY - canvas.getBoundingClientRect().top);

    pointerDownInProgressRef.current = false;
  }, []); // Empty deps - uses refs for all values

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLockedRef.current || boardFullRef.current) return; // Prevent interaction when locked

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    if (currentToolRef.current === 'eraser') {
      setCursorPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }

    if (activePointerIdRef.current === null || e.pointerId !== activePointerIdRef.current) {
      return;
    }

    e.preventDefault();

    const pressure = e.pressure || 0.5;
    const point = getNormalizedPoint(e.clientX, e.clientY, pressure);

    // Handle shape preview
    if (shapeInProgress) {
      const updatedShape = {
        ...shapeInProgress,
        points: [shapeInProgress.points[0], point],
      };
      setShapeInProgress(updatedShape);

      // Redraw canvas with preview
      const ctx = canvas.getContext('2d');
      if (ctx) {
        redrawCanvas();
        renderShape(ctx, updatedShape, canvas.width, canvas.height, { isDashed: true });
      }
      return;
    }

    if (!batcherRef.current) return;

    batcherRef.current.addPoint(point);
    drawPoint(e.clientX - rect.left, e.clientY - rect.top);
  }, [shapeInProgress, redrawCanvas]); // shapeInProgress and redrawCanvas as deps

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (activePointerIdRef.current === null || e.pointerId !== activePointerIdRef.current) {
      return;
    }

    e.preventDefault();
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    // Handle shape completion
    if (shapeInProgress) {
      const pressure = e.pressure || 0.5;
      const point = getNormalizedPoint(e.clientX, e.clientY, pressure);

      const completedShape: Shape = {
        ...shapeInProgress,
        points: [shapeInProgress.points[0], point],
        isComplete: true,
      };

      // Store in shapes
      shapesRef.current.set(completedShape.shapeId, completedShape);

      // Add to history for undo/redo
      setStrokeHistory(prev => [...prev, completedShape.shapeId]);
      setUndoneStrokes([]); // Clear redo stack

      // Send to server
      connectionRef.current.invoke(HubMethods.SendShape, completedShape).catch(err => {
        console.error('Failed to send shape:', err);
      });

      setShapeInProgress(null);

      // Redraw canvas and manually render the new shape (since state hasn't updated yet)
      redrawCanvas();
      const ctx = canvas.getContext('2d');
      if (ctx) {
        renderShape(ctx, completedShape, canvas.width, canvas.height);
      }

      activePointerIdRef.current = null;
      pointerDownInProgressRef.current = false;
      isDrawingRef.current = false;
      return;
    }

    if (batcherRef.current) {
      batcherRef.current.flush(true);
      batcherRef.current?.cancel();
      batcherRef.current = null;
    }

    // Update state AFTER pointer up to avoid re-renders during active pointer interaction
    if (currentStrokeIdRef.current) {
      const completedStrokeId = currentStrokeIdRef.current; // Capture value before clearing
      currentStrokeIdRef.current = null; // Clear immediately to prevent double-add
      setStrokeHistory(prev => [...prev, completedStrokeId]);
      setUndoneStrokes([]); // Clear redo stack
    }

    activePointerIdRef.current = null;
    pointerDownInProgressRef.current = false;
    isDrawingRef.current = false;
  }, [shapeInProgress, redrawCanvas]); // shapeInProgress and redrawCanvas as deps

  // Toolbar event handlers
  const handleColorChange = useCallback((color: string) => {
    setCurrentColor(color);
    setCurrentTool(prev => prev === 'eraser' ? 'pen' : prev);
  }, []);

  const handleThicknessChange = useCallback((thickness: number) => {
    setCurrentThickness(thickness);
  }, []);

  const handleToolChange = useCallback((tool: ToolType) => {
    setCurrentTool(tool);
  }, []);

  const handleConfidenceChange = useCallback((level: 'none' | 'red' | 'amber' | 'green') => {
    if (isLockedRef.current) return;

    setConfidenceLevel(level);
    connection.invoke(HubMethods.SetConfidence, level).catch(err => {
      console.error('Failed to set confidence:', err);
    });
  }, [connection]);

  const handleUndo = useCallback(() => {
    if (isLockedRef.current) return;
    if (strokeHistory.length === 0) return;

    const lastStrokeId = strokeHistory[strokeHistory.length - 1];
    const newHistory = strokeHistory.slice(0, -1);

    setStrokeHistory(newHistory);
    setUndoneStrokes(prev => [...prev, lastStrokeId]);

    // Redraw with the new history immediately
    redrawCanvas(newHistory);

    // Notify server so teacher view updates
    connection.invoke(HubMethods.UndoStroke, lastStrokeId).catch(err => {
      console.error('Failed to send undo:', err);
    });
  }, [strokeHistory, connection]);

  const handleRedo = useCallback(() => {
    if (isLockedRef.current) return;
    if (undoneStrokes.length === 0) return;

    const strokeToRedo = undoneStrokes[undoneStrokes.length - 1];
    const newHistory = [...strokeHistory, strokeToRedo];

    setUndoneStrokes(prev => prev.slice(0, -1));
    setStrokeHistory(newHistory);

    // Redraw with the new history immediately
    redrawCanvas(newHistory);

    if (connection.isPeer) {
      connection.invoke('RedoStroke', strokeToRedo).catch(() => setTransportStatus('Redo could not be synchronised'));
      return;
    }
    const restoredStroke = strokesRef.current.get(strokeToRedo);
    if (restoredStroke) {
      restoredStroke.batches.forEach(batch => {
        connection.invoke(HubMethods.SendStrokeBatch, batch).catch(err => {
          console.error('Failed to resend redone stroke batch:', err);
        });
      });
      return;
    }

    const restoredShape = shapesRef.current.get(strokeToRedo);
    if (restoredShape) {
      connection.invoke(HubMethods.SendShape, restoredShape).catch(err => {
        console.error('Failed to resend redone shape:', err);
      });
    }
  }, [undoneStrokes, strokeHistory, connection, redrawCanvas]);

  const handleClear = useCallback(() => {
    if (isLockedRef.current) return;
    batcherRef.current?.cancel();
    batcherRef.current = null;
    currentStrokeIdRef.current = null;
    isDrawingRef.current = false;
    pointerDownInProgressRef.current = false;
    activePointerIdRef.current = null;
    setShapeInProgress(null);

    strokesRef.current.clear();
    shapesRef.current.clear();
    setStrokeHistory([]);
    setUndoneStrokes([]);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    // Notify server so teacher view updates
    connection.invoke(HubMethods.ClearBoard).catch(err => {
      console.error('Failed to send clear:', err);
    });
  }, [connection]);

  const handleMouseEnter = useCallback(() => {
    // Cursor will be shown when mouse enters
  }, []);

  const handleMouseLeave = useCallback(() => {
    setCursorPosition(null);
  }, []);

  // Stable callback for toolbar resize that calls the ref function
  const handleToolbarResize = useCallback(() => {
    handleCanvasResize.current();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLockedRef.current) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    const hydrate = () => {
      const saved = connection.recoveredBoard?.() ?? recovered;
      if (!saved) return;
      setCurrentBackground(saved.backgroundType);
      setCurrentPaperColor(saved.paperColor);
      const indicators = connection.recoveredIndicators?.();
      if (indicators) {
        setConfidenceLevel(indicators.confidence);
        setHasAnswered(indicators.answered);
      }
      strokesRef.current.clear();
      for (const [id, batch] of Object.entries(saved.strokes)) {
        strokesRef.current.set(id, {
          strokeId: id, batches: [batch], color: batch.color,
          lineWidth: batch.lineWidth, isEraser: !!batch.isEraser,
        });
      }
      shapesRef.current = new Map(Object.entries(saved.shapes));
      setStrokeHistory(saved.drawOrder);
      strokeHistoryRef.current = saved.drawOrder;
      setUndoneStrokes(Object.keys(saved.strokes).concat(Object.keys(saved.shapes))
        .filter(id => !saved.drawOrder.includes(id)));
      redrawCanvas(saved.drawOrder);
    };
    hydrate();
    connection.on('localBoardReconciled', hydrate);
    const capacity = ({full}: {full: boolean}) => setBoardFull(full);
    connection.on('boardCapacity', capacity);
    const status = ({ status }: { status: string }) => setTransportStatus(status);
    connection.on('transportStatus', status);
    return () => {
      connection.off('transportStatus', status);
      connection.off('localBoardReconciled', hydrate);
      connection.off('boardCapacity', capacity);
    };
  }, [connection]);

  useEffect(() => {
    if (!isLocked && !boardFull) return;
    // Discard an unfinished gesture when authority changes. Never flush it after a clear.
    batcherRef.current?.cancel();
    batcherRef.current = null;
    currentStrokeIdRef.current = null;
    isDrawingRef.current = false;
    activePointerIdRef.current = null;
    setShapeInProgress(null);
  }, [isLocked, boardFull]);

  // Track isLocked changes
  useEffect(() => {
    debugLog('DrawingPage', 'isLocked changed', isLocked);
  }, [isLocked]);

  return (
    <div className={`drawing-container ${isClassroomLocked ? 'drawing-locked' : ''}`}>
      {transportStatus && <div className="transport-status" role="status">{transportStatus}</div>}
      <Toolbar
        displayName={displayName}
        currentColor={currentColor}
        currentThickness={currentThickness}
        currentTool={currentTool}
        currentConfidence={confidenceLevel}
        currentBackground={currentBackground}
        currentPaperColor={currentPaperColor}
        onColorChange={handleColorChange}
        onThicknessChange={handleThicknessChange}
        onToolChange={handleToolChange}
        onConfidenceChange={handleConfidenceChange}
        onBackgroundChange={setCurrentBackground}
        onPaperColorChange={setCurrentPaperColor}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        onToolbarResized={handleToolbarResize}
        canUndo={strokeHistory.length > 0}
        canRedo={undoneStrokes.length > 0}
      />
      <div className="canvas-wrapper">
        {currentQuestion && currentQuestion.trim().length > 0 && (
          <div className="question-banner">
            <div className="question-banner-text">{currentQuestion}</div>
            <button
              type="button"
              className={`question-answered-btn ${hasAnswered ? 'answered' : 'not-answered'}`}
              onClick={handleAnsweredToggle}
              aria-pressed={hasAnswered}
            >
              {hasAnswered ? <CheckIcon size={16} /> : null}
              {hasAnswered ? 'Answered' : 'Answer'}
            </button>
          </div>
        )}
        <canvas
          ref={backgroundCanvasRef}
          className="background-canvas"
        />
        <canvas
          ref={canvasRef}
          className={`drawing-canvas ${currentTool === 'eraser' ? 'erasing' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
        {currentTool === 'eraser' && cursorPosition && (
          <div
            className="eraser-cursor"
            style={{
              left: `${cursorPosition.x}px`,
              top: `${cursorPosition.y}px`,
              width: `${currentThickness * 2}px`,
              height: `${currentThickness * 2}px`,
            }}
          />
        )}
        {isClassroomLocked && (
          <div className="locked-overlay">
            <div className="locked-message">
              <span className="lock-icon">🔒</span>
              <span className="lock-text">Drawing is locked by your teacher</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DrawingPage;
