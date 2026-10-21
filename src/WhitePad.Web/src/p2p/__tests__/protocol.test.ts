import { describe, it, expect } from "vitest";
import {
  apply,
  emptyBoard,
  Operation,
  Body,
  encodePoints,
  decodePoints,
  validateBoard,
  RateLimit,
  MAX_OPERATIONS,
  rewindBoard,
} from "../protocol";
import { materialise } from "../render";
import { Channel, MAX_QUEUE, HIGH_WATER, backoff } from "../channel";
const op = (seq: number, body: Body, epoch = 0): Operation => ({
  v: 1,
  opId: `operation-${seq}`,
  seq,
  epoch,
  body,
});
const start: Body = {
  type: "start",
  id: "stroke",
  style: { color: "#123456", width: 2, eraser: false },
};
describe("versioned canonical boards", () => {
  it("applies duplicate delivery once and requests gaps without mutating", () => {
    const b = emptyBoard();
    const a = op(1, start);
    expect(apply(b, a)).toBe("applied");
    expect(apply(b, a)).toBe("duplicate");
    expect(apply(b, op(3, { type: "end", id: "stroke" }))).toBe("gap");
    expect(b.seq).toBe(1);
  });
  it("clear generation rejects delayed and forged future content", () => {
    const b = emptyBoard();
    apply(b, op(1, start));
    apply(b, op(2, { type: "clear" }, 1));
    expect(apply(b, op(3, start, 0))).toBe("stale");
    expect(apply(b, op(3, start, 2))).toBe("stale");
    expect(apply(b, op(1, start))).toBe("duplicate");
    expect(materialise(b, "s").drawOrder).toEqual([]);
    expect(validateBoard(b)).toBe(true);
  });
  it("undo/redo replay preserves erasing, shapes and backgrounds", () => {
    const b = emptyBoard();
    const bodies: Body[] = [
      { type: "background", pattern: "squares", paper: "buff" },
      start,
      {
        type: "points",
        id: "stroke",
        points: [
          [0, 0, 10],
          [65535, 65535, 255],
        ],
      },
      { type: "end", id: "stroke" },
      { type: "undo", id: "stroke" },
      { type: "redo", id: "stroke" },
      {
        type: "shape",
        id: "shape",
        shape: "circle",
        points: [
          [0, 0, 255],
          [500, 500, 255],
        ],
        style: { color: "#000000", width: 3, eraser: false },
      },
    ];
    bodies.forEach((body, i) => apply(b, op(i + 1, body)));
    const restored = JSON.parse(JSON.stringify(b));
    expect(validateBoard(restored)).toBe(true);
    expect(materialise(restored, "s").drawOrder).toEqual(["stroke", "shape"]);
    expect(materialise(restored, "s").paperColor).toBe("buff");
  });
  it("rejects corrupt snapshots, unknown strokes and repeated operation IDs", () => {
    const b = emptyBoard();
    expect(() =>
      apply(b, op(1, { type: "points", id: "missing", points: [] })),
    ).toThrow();
    apply(b, op(1, start));
    expect(() =>
      apply(b, {
        ...op(2, { type: "end", id: "stroke" }),
        opId: "operation-1",
      }),
    ).toThrow();
    expect(validateBoard({ ...b, seq: 8 })).toBe(false);
    expect(
      validateBoard({ ...b, operations: [{ ...b.operations[0], v: 2 }] }),
    ).toBe(false);
  });
  it("bounds operation memory and allows clear at capacity", () => {
    const b = emptyBoard();
    for (let i = 1; i <= MAX_OPERATIONS; i++)
      apply(b, op(i, { type: "answered", value: false }));
    expect(() =>
      apply(b, op(MAX_OPERATIONS + 1, { type: "answered", value: true })),
    ).toThrow();
    expect(apply(b, op(MAX_OPERATIONS + 1, { type: "clear" }, 1))).toBe(
      "applied",
    );
    expect(b.operations).toHaveLength(1);
  });
  it("rewinds unacknowledged changes after teacher reconciliation including an offline clear", () => {
    const b = emptyBoard();
    apply(b, op(1, start));
    apply(b, op(2, { type: "points", id: "stroke", points: [[1, 2, 3]] }));
    const checkpoint = { ...b, operations: [...b.operations] };
    apply(b, op(3, { type: "clear" }, 1));
    apply(b, op(4, { type: "answered", value: true }, 1));
    const restored = rewindBoard(b, 2, checkpoint);
    expect(restored.seq).toBe(2);
    expect(materialise(restored, "s").drawOrder).toEqual(["stroke"]);
    expect(validateBoard(restored)).toBe(true);
  });
  it("quantises within half a uint16 unit and preserves endpoints and pressure", () => {
    const ps = [
      { x: 0.1, y: 0.2, pressure: 0.5 },
      { x: 0.100001, y: 0.200001, pressure: 0.5 },
      { x: 0.2, y: 0.3, pressure: 1 },
    ];
    const encoded = encodePoints(ps);
    expect(encoded).toHaveLength(2);
    expect(Math.abs(decodePoints(encoded)[0].x - ps[0].x)).toBeLessThan(
      1 / 65535,
    );
    expect(encoded.at(-1)?.[2]).toBe(255);
  });
  it("rejects non-finite coordinates, oversized batches and unsupported types", () => {
    const b = emptyBoard();
    apply(b, op(1, start));
    for (const points of [[[NaN, 0, 0]], Array(257).fill([1, 1, 1])])
      expect(() =>
        apply(b, op(2, { type: "points", id: "stroke", points } as Body)),
      ).toThrow();
    expect(() => apply(b, op(2, { type: "admin" } as any))).toThrow();
  });
});
describe("untrusted drawing identities", () => {
  it("rejects object-prototype keys and malformed snapshot roots", () => {
    for (const id of ["__proto__", "constructor", "toString", "prototype"])
      expect(() =>
        apply(emptyBoard(), op(1, { ...start, id } as Body)),
      ).toThrow();
    expect(validateBoard({ seq: 1, epoch: 0, operations: [null] })).toBe(false);
  });
});
describe("transport bounds", () => {
  it("limits bufferedAmount and drops an overfull queue into recovery", () => {
    let overflow = 0;
    const rtc = {
      readyState: "open",
      bufferedAmount: HIGH_WATER,
      send() {
        throw Error("Must not send");
      },
      close() {},
    } as unknown as RTCDataChannel;
    const ch = new Channel(
      rtc,
      () => {},
      () => overflow++,
    );
    for (let i = 0; i < 200; i++) ch.send({ data: "x".repeat(8000) });
    expect(ch.pending).toBeLessThanOrEqual(MAX_QUEUE + HIGH_WATER);
    expect(overflow).toBeGreaterThan(0);
  });
  it("bounds ingress and uses capped jitter", () => {
    const rate = new RateLimit(2, 1);
    expect(rate.take()).toBe(true);
    expect(rate.take()).toBe(true);
    expect(rate.take()).toBe(false);
    expect(backoff(30, () => 1)).toBe(30000);
    expect(backoff(0, () => 0)).toBe(250);
  });
});
