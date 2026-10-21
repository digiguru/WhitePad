"use strict";
var WhitePadProtocol = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/WhitePad.Web/src/p2p/protocol.ts
  var protocol_exports = {};
  __export(protocol_exports, {
    MAX_BOARD_BYTES: () => MAX_BOARD_BYTES,
    MAX_FRAME: () => MAX_FRAME,
    MAX_OPERATIONS: () => MAX_OPERATIONS,
    RateLimit: () => RateLimit,
    VERSION: () => VERSION,
    apply: () => apply,
    decodePoints: () => decodePoints,
    emptyBoard: () => emptyBoard,
    encodePoints: () => encodePoints,
    identifier: () => identifier,
    integer: () => integer,
    rewindBoard: () => rewindBoard,
    styleFor: () => styleFor,
    validBody: () => validBody,
    validOperation: () => validOperation,
    validateBoard: () => validateBoard
  });
  var VERSION = 1;
  var MAX_FRAME = 16 * 1024;
  var MAX_BOARD_BYTES = 4 * 1024 * 1024;
  var MAX_OPERATIONS = 2e4;
  var emptyBoard = () => ({ epoch: 0, seq: 0, operations: [] });
  var integer = (x, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= 0 && x <= max;
  var identifier = (x) => typeof x === "string" && !(x in Object.prototype) && x !== "prototype" && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
  var choices = (x, values) => typeof x === "string" && values.includes(x);
  function points(x, max) {
    return Array.isArray(x) && x.length <= max && x.every(
      (p) => Array.isArray(p) && p.length === 3 && integer(p[0], 65535) && integer(p[1], 65535) && integer(p[2], 255)
    );
  }
  function style(x) {
    return !!x && typeof x.color === "string" && /^(#[0-9a-fA-F]{6}|__WHITEPAD_ERASER__)$/.test(x.color) && typeof x.width === "number" && Number.isFinite(x.width) && x.width > 0 && x.width <= 100 && typeof x.eraser === "boolean";
  }
  function validBody(b) {
    if (!b || typeof b !== "object") return false;
    switch (b.type) {
      case "start":
        return identifier(b.id) && style(b.style);
      case "points":
        return identifier(b.id) && points(b.points, 256);
      case "shape":
        return identifier(b.id) && style(b.style) && points(b.points, 16) && b.points.length >= 2 && choices(b.shape, [
          "line",
          "rectangle",
          "circle",
          "arrow",
          "axesL",
          "axesCross"
        ]);
      case "end":
      case "undo":
      case "redo":
        return identifier(b.id);
      case "clear":
        return true;
      case "background":
        return choices(b.pattern, ["none", "dotted", "lined", "squares"]) && choices(b.paper, ["white", "buff"]);
      case "confidence":
        return choices(b.value, ["none", "red", "amber", "green"]);
      case "answered":
        return typeof b.value === "boolean";
      default:
        return false;
    }
  }
  function validOperation(o) {
    return !!o && o.v === 1 && identifier(o.opId) && integer(o.seq) && o.seq > 0 && integer(o.epoch) && validBody(o.body) && JSON.stringify(o).length <= MAX_FRAME;
  }
  var indexes = /* @__PURE__ */ new WeakMap();
  function index(board) {
    let value = indexes.get(board);
    if (!value || value.operations !== board.operations || value.length !== board.operations.length) {
      value = {
        operations: board.operations,
        length: board.operations.length,
        bytes: JSON.stringify(board.operations).length,
        ids: new Set(board.operations.map((o) => o.opId)),
        objects: /* @__PURE__ */ new Map()
      };
      for (const o of board.operations) track(value.objects, o.body);
      indexes.set(board, value);
    }
    return value;
  }
  function track(objects, b) {
    if (b.type === "start" || b.type === "shape")
      objects.set(b.id, {
        ended: b.type === "shape",
        hidden: false,
        style: b.style
      });
    if (b.type === "end" && objects.has(b.id)) objects.get(b.id).ended = true;
    if ((b.type === "undo" || b.type === "redo") && objects.has(b.id))
      objects.get(b.id).hidden = b.type === "undo";
  }
  function apply(board, op) {
    if (!validOperation(op)) throw new Error("Invalid operation");
    if (op.seq <= board.seq) return "duplicate";
    if (op.seq !== board.seq + 1) return "gap";
    if (op.epoch < board.epoch) return "stale";
    if (op.body.type === "clear" ? op.epoch !== board.epoch + 1 : op.epoch !== board.epoch)
      return "stale";
    const state = index(board);
    if (state.ids.has(op.opId)) throw new Error("Reused operation ID");
    const b = op.body;
    if ((b.type === "start" || b.type === "shape") && state.objects.has(b.id))
      throw new Error("Duplicate object");
    if ((b.type === "points" || b.type === "end" || b.type === "undo" || b.type === "redo") && !state.objects.has(b.id))
      throw new Error("Unknown object");
    if (b.type === "points" && state.objects.get(b.id).ended)
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
    if (board.operations.length >= MAX_OPERATIONS || state.bytes + bytes > MAX_BOARD_BYTES - 1024)
      throw new Error(
        "Board storage limit reached. Clear the board to continue."
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
  function validateBoard(value) {
    if (!value || !integer(value.epoch) || !integer(value.seq) || !Array.isArray(value.operations) || value.operations.length > MAX_OPERATIONS || JSON.stringify(value).length > MAX_BOARD_BYTES)
      return false;
    const ops = value.operations;
    if (!ops.length) return value.seq === 0 && value.epoch === 0;
    const first = ops[0];
    if (!validOperation(first) || first.body.type !== "clear" && first.seq !== 1)
      return false;
    const test = {
      seq: first.seq - 1,
      epoch: first.body?.type === "clear" ? first.epoch - 1 : 0,
      operations: []
    };
    try {
      for (const op of ops) if (apply(test, op) !== "applied") return false;
    } catch {
      return false;
    }
    return test.seq === value.seq && test.epoch === value.epoch;
  }
  function styleFor(board, id) {
    return index(board).objects.get(id)?.style;
  }
  function rewindBoard(board, confirmedSeq, beforeClear) {
    const source = board.operations[0]?.seq > confirmedSeq ? beforeClear : board;
    if (!source) return emptyBoard();
    const operations = source.operations.filter((o) => o.seq <= confirmedSeq);
    const last = operations.at(-1);
    return last ? { seq: last.seq, epoch: last.epoch, operations } : emptyBoard();
  }
  function encodePoints(input) {
    const out = [];
    input.forEach((p, i) => {
      const q = [
        Math.round(Math.max(0, Math.min(1, p.x)) * 65535),
        Math.round(Math.max(0, Math.min(1, p.y)) * 65535),
        Math.round(Math.max(0, Math.min(1, p.pressure)) * 255)
      ];
      const last = out[out.length - 1];
      if (!last || i === input.length - 1 || Math.hypot(q[0] - last[0], q[1] - last[1]) > 16 || Math.abs(q[2] - last[2]) > 2)
        out.push(q);
    });
    return out;
  }
  var decodePoints = (ps) => ps.map(([x, y, p]) => ({ x: x / 65535, y: y / 65535, pressure: p / 255 }));
  var RateLimit = class {
    constructor(capacity, perSecond) {
      this.capacity = capacity;
      this.perSecond = perSecond;
      __publicField(this, "tokens");
      __publicField(this, "at", Date.now());
      this.tokens = capacity;
    }
    take(cost = 1, now = Date.now()) {
      this.tokens = Math.min(
        this.capacity,
        this.tokens + (now - this.at) * this.perSecond / 1e3
      );
      this.at = now;
      if (this.tokens < cost) return false;
      this.tokens -= cost;
      return true;
    }
  };
  return __toCommonJS(protocol_exports);
})();
