/** WhitePad peer protocol v1. Coordinates are unsigned 16-bit; pressure is 8-bit. */
export const VERSION = 1;
export const MAX_FRAME = 16 * 1024;
export const MAX_BOARD_BYTES = 4 * 1024 * 1024;
export const MAX_OPERATIONS = 20000;
export type Point = [number, number, number];
export type Style = { color: string; width: number; eraser: boolean };
export type Body =
  | { type: "start"; id: string; style: Style }
  | { type: "points"; id: string; points: Point[] }
  | { type: "end"; id: string }
  | {
      type: "shape";
      id: string;
      shape: "line" | "rectangle" | "circle" | "arrow" | "axesL" | "axesCross";
      points: Point[];
      style: Style;
    }
  | { type: "undo" | "redo"; id: string }
  | { type: "clear" }
  | {
      type: "background";
      pattern: "none" | "dotted" | "lined" | "squares";
      paper: "white" | "buff";
    }
  | { type: "confidence"; value: "none" | "red" | "amber" | "green" }
  | { type: "answered"; value: boolean };
export type Operation = {
  v: 1;
  opId: string;
  seq: number;
  epoch: number;
  body: Body;
};
export type MemberControl = {
  id: string;
  locked: boolean;
  epoch: number;
  revision: number;
};
export type Controls = {
  question: string | null;
  questionRevision: number;
  members: MemberControl[];
};
export type PeerHeader = {
  v: 1;
  revision: number;
  controlEpoch: number;
  questionRevision: number;
};
export type PeerFrame = PeerHeader &
  (
    | { type: "hello" | "ack"; seq: number }
    | { type: "resync" }
    | { type: "op"; op: Operation; sentAt?: number }
    | { type: "snapshot-start"; id: string; total: number }
    | { type: "snapshot-chunk"; id: string; index: number; data: string }
    | { type: "snapshot-end"; id: string }
  );
export type Board = { epoch: number; seq: number; operations: Operation[] };
export const emptyBoard = (): Board => ({ epoch: 0, seq: 0, operations: [] });
export const integer = (
  x: unknown,
  max = Number.MAX_SAFE_INTEGER,
): x is number =>
  Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= max;
export const identifier = (x: unknown): x is string =>
  typeof x === "string" &&
  !(x in Object.prototype) &&
  x !== "prototype" &&
  /^[a-zA-Z0-9_-]{1,128}$/.test(x);
const choices = (x: unknown, values: string[]) =>
  typeof x === "string" && values.includes(x);
function points(x: unknown, max: number): x is Point[] {
  return (
    Array.isArray(x) &&
    x.length <= max &&
    x.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 3 &&
        integer(p[0], 65535) &&
        integer(p[1], 65535) &&
        integer(p[2], 255),
    )
  );
}
function style(x: any): x is Style {
  return (
    !!x &&
    typeof x.color === "string" &&
    /^(#[0-9a-fA-F]{6}|__WHITEPAD_ERASER__)$/.test(x.color) &&
    typeof x.width === "number" &&
    Number.isFinite(x.width) &&
    x.width > 0 &&
    x.width <= 100 &&
    typeof x.eraser === "boolean"
  );
}
export function validBody(b: any): b is Body {
  if (!b || typeof b !== "object") return false;
  switch (b.type) {
    case "start":
      return identifier(b.id) && style(b.style);
    case "points":
      return identifier(b.id) && points(b.points, 256);
    case "shape":
      return (
        identifier(b.id) &&
        style(b.style) &&
        points(b.points, 16) &&
        b.points.length >= 2 &&
        choices(b.shape, [
          "line",
          "rectangle",
          "circle",
          "arrow",
          "axesL",
          "axesCross",
        ])
      );
    case "end":
    case "undo":
    case "redo":
      return identifier(b.id);
    case "clear":
      return true;
    case "background":
      return (
        choices(b.pattern, ["none", "dotted", "lined", "squares"]) &&
        choices(b.paper, ["white", "buff"])
      );
    case "confidence":
      return choices(b.value, ["none", "red", "amber", "green"]);
    case "answered":
      return typeof b.value === "boolean";
    default:
      return false;
  }
}
export function validOperation(o: any): o is Operation {
  return (
    !!o &&
    o.v === 1 &&
    identifier(o.opId) &&
    integer(o.seq) &&
    o.seq > 0 &&
    integer(o.epoch) &&
    validBody(o.body) &&
    JSON.stringify(o).length <= MAX_FRAME
  );
}
const indexes = new WeakMap<
  Board,
  {
    operations: Operation[];
    length: number;
    bytes: number;
    ids: Set<string>;
    objects: Map<string, { ended: boolean; hidden: boolean; style?: Style }>;
  }
>();
function index(board: Board) {
  let value = indexes.get(board);
  if (
    !value ||
    value.operations !== board.operations ||
    value.length !== board.operations.length
  ) {
    value = {
      operations: board.operations,
      length: board.operations.length,
      bytes: JSON.stringify(board.operations).length,
      ids: new Set(board.operations.map((o) => o.opId)),
      objects: new Map(),
    };
    for (const o of board.operations) track(value.objects, o.body);
    indexes.set(board, value);
  }
  return value;
}
function track(
  objects: Map<string, { ended: boolean; hidden: boolean; style?: Style }>,
  b: Body,
) {
  if (b.type === "start" || b.type === "shape")
    objects.set(b.id, {
      ended: b.type === "shape",
      hidden: false,
      style: b.style,
    });
  if (b.type === "end" && objects.has(b.id)) objects.get(b.id)!.ended = true;
  if ((b.type === "undo" || b.type === "redo") && objects.has(b.id))
    objects.get(b.id)!.hidden = b.type === "undo";
}
/** Contiguous ordered prefix only. Duplicate sequence numbers never apply twice. */
export function apply(
  board: Board,
  op: Operation,
): "applied" | "duplicate" | "gap" | "stale" {
  if (!validOperation(op)) throw new Error("Invalid operation");
  if (op.seq <= board.seq) return "duplicate";
  if (op.seq !== board.seq + 1) return "gap";
  if (op.epoch < board.epoch) return "stale";
  if (
    op.body.type === "clear"
      ? op.epoch !== board.epoch + 1
      : op.epoch !== board.epoch
  )
    return "stale";
  const state = index(board);
  if (state.ids.has(op.opId)) throw new Error("Reused operation ID");
  const b = op.body;
  if ((b.type === "start" || b.type === "shape") && state.objects.has(b.id))
    throw new Error("Duplicate object");
  if (
    (b.type === "points" ||
      b.type === "end" ||
      b.type === "undo" ||
      b.type === "redo") &&
    !state.objects.has(b.id)
  )
    throw new Error("Unknown object");
  if (b.type === "points" && state.objects.get(b.id)!.ended)
    throw new Error("Stroke already ended");
  if (b.type === "clear") {
    board.operations = [];
    state.operations = board.operations;
    state.length = 0;
    state.bytes = 2;
    state.ids.clear();
    state.objects.clear();
  }
  const bytes = JSON.stringify(op).length + 1;
  if (
    board.operations.length >= MAX_OPERATIONS ||
    state.bytes + bytes > MAX_BOARD_BYTES - 1024
  )
    throw new Error(
      "Board storage limit reached. Clear the board to continue.",
    );
  state.bytes += bytes;
  state.length++;
  state.ids.add(op.opId);
  track(state.objects, b);
  board.operations.push(op);
  board.seq = op.seq;
  board.epoch = op.epoch;
  return "applied";
}
export function validateBoard(value: any): value is Board {
  if (
    !value ||
    !integer(value.epoch) ||
    !integer(value.seq) ||
    !Array.isArray(value.operations) ||
    value.operations.length > MAX_OPERATIONS ||
    JSON.stringify(value).length > MAX_BOARD_BYTES
  )
    return false;
  const ops = value.operations as Operation[];
  if (!ops.length) return value.seq === 0 && value.epoch === 0;
  const first = ops[0];
  if (
    !validOperation(first) ||
    (first.body.type !== "clear" && first.seq !== 1)
  )
    return false;
  const test: Board = {
    seq: first.seq - 1,
    epoch: first.body?.type === "clear" ? first.epoch - 1 : 0,
    operations: [],
  };
  try {
    for (const op of ops) if (apply(test, op) !== "applied") return false;
  } catch {
    return false;
  }
  return test.seq === value.seq && test.epoch === value.epoch;
}
/** Discard unacknowledged offline edits when durable teacher authority changes. */
export function styleFor(board: Board, id: string) {
  return index(board).objects.get(id)?.style;
}

export function rewindBoard(
  board: Board,
  confirmedSeq: number,
  beforeClear?: Board,
): Board {
  const source = board.operations[0]?.seq > confirmedSeq ? beforeClear : board;
  if (!source) return emptyBoard();
  const operations = source.operations.filter((o) => o.seq <= confirmedSeq);
  const last = operations.at(-1);
  return last ? { seq: last.seq, epoch: last.epoch, operations } : emptyBoard();
}
export function encodePoints(
  input: { x: number; y: number; pressure: number }[],
): Point[] {
  const out: Point[] = [];
  input.forEach((p, i) => {
    const q: Point = [
      Math.round(Math.max(0, Math.min(1, p.x)) * 65535),
      Math.round(Math.max(0, Math.min(1, p.y)) * 65535),
      Math.round(Math.max(0, Math.min(1, p.pressure)) * 255),
    ];
    const last = out[out.length - 1];
    // Remove only near-identical samples (<0.025% canvas size), preserving endpoints and pressure changes.
    if (
      !last ||
      i === input.length - 1 ||
      Math.hypot(q[0] - last[0], q[1] - last[1]) > 16 ||
      Math.abs(q[2] - last[2]) > 2
    )
      out.push(q);
  });
  return out;
}
export const decodePoints = (ps: Point[]) =>
  ps.map(([x, y, p]) => ({ x: x / 65535, y: y / 65535, pressure: p / 255 }));
export class RateLimit {
  private tokens: number;
  private at = Date.now();
  constructor(
    private capacity: number,
    private perSecond: number,
  ) {
    this.tokens = capacity;
  }
  take(cost = 1, now = Date.now()) {
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.at) * this.perSecond) / 1000,
    );
    this.at = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
