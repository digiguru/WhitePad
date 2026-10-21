import { describe, it, expect } from "vitest";
import { canAppendBoard } from "../boardRenderer";
import {
  applyStrokeBatchToBoard,
  applyUndoToBoard,
  emptyTeacherBoard,
} from "../teacherBoardState";
const batch = {
  studentId: "s",
  strokeId: "a",
  color: "#000000",
  lineWidth: 2,
  isComplete: false,
  points: [{ x: 0.1, y: 0.2, pressure: 1 }],
};
describe("incremental teacher drawing plan", () => {
  it("accepts append-only stroke points while detecting undo and replacement", () => {
    const start = applyStrokeBatchToBoard(emptyTeacherBoard(), batch);
    const next = applyStrokeBatchToBoard(start, {
      ...batch,
      points: [{ x: 0.2, y: 0.3, pressure: 1 }],
    });
    expect(canAppendBoard(start, next)).toBe(true);
    expect(
      canAppendBoard(
        next,
        applyUndoToBoard(next, { studentId: "s", strokeId: "a" }),
      ),
    ).toBe(false);
    expect(
      canAppendBoard(next, {
        ...next,
        strokes: {
          a: {
            ...next.strokes.a,
            points: next.strokes.a.points.map((p) => ({ ...p })),
          },
        },
      }),
    ).toBe(false);
  });
  it("forces redraw when a continuation would paint above later drawing objects", () => {
    const start = applyStrokeBatchToBoard(emptyTeacherBoard(), batch);
    const next = applyStrokeBatchToBoard(start, { ...batch, strokeId: "b" });
    const oldContinuation = applyStrokeBatchToBoard(next, {
      ...batch,
      points: [{ x: 0.3, y: 0.4, pressure: 1 }],
    });
    expect(canAppendBoard(next, oldContinuation)).toBe(false);
  });
});
