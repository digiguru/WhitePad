import { Board, decodePoints, Operation, styleFor } from "./protocol";
import {
  emptyTeacherBoard,
  TeacherBoardState,
} from "../teacher/teacherBoardState";
import { StrokeBatch } from "../shared/types/messages";
/** Materialise once for refresh/snapshot. Ordinary traffic uses incremental legacy UI events. */
export function materialise(
  board: Board,
  studentId: string,
): TeacherBoardState {
  const result = emptyTeacherBoard();
  const hidden = new Set<string>();
  for (const op of board.operations) {
    const b = op.body;
    switch (b.type) {
      case "clear":
        result.strokes = {};
        result.shapes = {};
        result.drawOrder = [];
        hidden.clear();
        break;
      case "start":
        result.strokes[b.id] = {
          studentId,
          strokeId: b.id,
          points: [],
          color: b.style.color,
          lineWidth: b.style.width,
          isEraser: b.style.eraser,
          isComplete: false,
        };
        result.drawOrder.push(b.id);
        break;
      case "points":
        if (result.strokes[b.id])
          result.strokes[b.id].points.push(...decodePoints(b.points));
        break;
      case "end":
        if (result.strokes[b.id]) result.strokes[b.id].isComplete = true;
        break;
      case "shape":
        result.shapes[b.id] = {
          studentId,
          shapeId: b.id,
          type: b.shape,
          points: decodePoints(b.points),
          color: b.style.color,
          lineWidth: b.style.width,
          isComplete: true,
        };
        result.drawOrder.push(b.id);
        break;
      case "undo":
        hidden.add(b.id);
        break;
      case "redo":
        hidden.delete(b.id);
        break;
      case "background":
        result.backgroundType = b.pattern;
        result.paperColor = b.paper;
        break;
    }
  }
  result.drawOrder = result.drawOrder.filter((id) => !hidden.has(id));
  return result;
}
export function operationEvent(
  op: Operation,
  board: Board,
  studentId: string,
  emit: (name: string, data: any) => void,
) {
  const b = op.body;
  if (b.type === "start" || b.type === "end") return;
  if (b.type === "points") {
    const style = styleFor(board, b.id);
    if (!style) return;
    emit("receiveStrokeBatch", {
      studentId,
      strokeId: b.id,
      points: decodePoints(b.points),
      color: style.color,
      lineWidth: style.width,
      isEraser: style.eraser,
      isComplete: false,
    } satisfies StrokeBatch);
  } else if (b.type === "shape")
    emit("receiveShape", {
      studentId,
      shapeId: b.id,
      type: b.shape,
      points: decodePoints(b.points),
      color: b.style.color,
      lineWidth: b.style.width,
      isComplete: true,
    });
  else if (b.type === "undo")
    emit("strokeUndone", { studentId, strokeId: b.id });
  else if (b.type === "redo")
    emit("boardRecovered", { studentId, board: materialise(board, studentId) });
  else if (b.type === "clear") emit("boardCleared", { studentId });
  else if (b.type === "background")
    emit("receiveStrokeBatch", {
      studentId,
      strokeId: "background",
      points: [],
      color: "#000000",
      lineWidth: 1,
      isComplete: true,
      backgroundType: b.pattern,
      paperColor: b.paper,
    });
  else if (b.type === "confidence")
    emit("confidenceChanged", { studentId, confidenceLevel: b.value });
  else if (b.type === "answered")
    emit("answeredChanged", { studentId, hasAnswered: b.value });
}
