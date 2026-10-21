import { renderShape } from "../shared/utils/shapeRenderer";
import type { StrokeBatch } from "../shared/types/messages";
import { isEraserBatch, TeacherBoardState } from "./teacherBoardState";

type Cache = {
  ink: HTMLCanvasElement;
  previous: TeacherBoardState;
  scale: number;
};
const caches = new WeakMap<HTMLCanvasElement, Cache>();

/** Only append at the top of the existing drawing order; undo/replay/replacement redraws. */
export function canAppendBoard(
  previous: TeacherBoardState,
  next: TeacherBoardState,
): boolean {
  if (previous.drawOrder.length > next.drawOrder.length) return false;
  for (let i = 0; i < previous.drawOrder.length; i++) {
    const id = previous.drawOrder[i];
    if (next.drawOrder[i] !== id) return false;
    const old = previous.strokes[id],
      stroke = next.strokes[id];
    if (old === stroke && previous.shapes[id] === next.shapes[id]) continue;
    if (
      !old ||
      !stroke ||
      i !== previous.drawOrder.length - 1 ||
      old.color !== stroke.color ||
      old.lineWidth !== stroke.lineWidth ||
      isEraserBatch(old) !== isEraserBatch(stroke) ||
      old.points.length > stroke.points.length
    )
      return false;
    if (
      old.points.length &&
      old.points.at(-1) !== stroke.points[old.points.length - 1]
    )
      return false;
  }
  return true;
}
function stroke(
  ctx: CanvasRenderingContext2D,
  batch: StrokeBatch,
  width: number,
  height: number,
  scale: number,
  from = 0,
) {
  if (!batch.points.length || from >= batch.points.length) return;
  ctx.save();
  ctx.globalCompositeOperation = isEraserBatch(batch)
    ? "destination-out"
    : "source-over";
  ctx.strokeStyle = batch.color;
  ctx.fillStyle = batch.color;
  ctx.lineWidth = Math.abs(batch.lineWidth || 2) * scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const first = batch.points[Math.max(0, from - 1)];
  if (batch.points.length === 1) {
    ctx.arc(
      first.x * width,
      first.y * height,
      ctx.lineWidth / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  } else {
    ctx.moveTo(first.x * width, first.y * height);
    for (let i = Math.max(1, from); i < batch.points.length; i++) {
      const point = batch.points[i];
      ctx.lineTo(point.x * width, point.y * height);
    }
    ctx.stroke();
  }
  ctx.restore();
}
export function invalidateBoardCanvas(canvas: HTMLCanvasElement) {
  caches.delete(canvas);
}
export function renderBoardCanvas(
  canvas: HTMLCanvasElement,
  board: TeacherBoardState,
  scale: number,
  background: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) => void,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  let cache = caches.get(canvas);
  const full =
    !cache ||
    cache.ink.width !== canvas.width ||
    cache.ink.height !== canvas.height ||
    cache.scale !== scale ||
    !canAppendBoard(cache.previous, board);
  if (!cache) {
    cache = { ink: document.createElement("canvas"), previous: board, scale };
    caches.set(canvas, cache);
  }
  if (full) {
    cache.ink.width = canvas.width;
    cache.ink.height = canvas.height;
    cache.scale = scale;
  }
  const ink = cache.ink.getContext("2d");
  if (!ink) return;
  for (const id of board.drawOrder) {
    const batch = board.strokes[id];
    if (batch) {
      if (full || cache.previous.strokes[id] !== batch)
        stroke(
          ink,
          batch,
          canvas.width,
          canvas.height,
          scale,
          full ? 0 : (cache.previous.strokes[id]?.points.length ?? 0),
        );
    } else if (
      board.shapes[id] &&
      (full || cache.previous.shapes[id] !== board.shapes[id])
    )
      renderShape(ink, board.shapes[id], canvas.width, canvas.height, {
        lineWidthScale: scale,
      });
  }
  cache.previous = board;
  context.clearRect(0, 0, canvas.width, canvas.height);
  background(context, canvas.width, canvas.height);
  context.drawImage(cache.ink, 0, 0);
}
