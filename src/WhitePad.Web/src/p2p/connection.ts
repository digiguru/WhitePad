import type { ClassroomConnection } from "../services/connection";
import {
  apply,
  Board,
  Body,
  emptyBoard,
  encodePoints,
  integer,
  MAX_BOARD_BYTES,
  Operation,
  validOperation,
  validateBoard,
  rewindBoard,
  styleFor,
  Controls,
  PeerHeader,
} from "./protocol";
import { backoff, Channel, gather } from "./channel";
import { loadBoard, saveBoard } from "./storage";
import { materialise, operationEvent } from "./render";
import type { Shape, StrokeBatch } from "../shared/types/messages";

type Peer = {
  pc: RTCPeerConnection;
  attempt: string;
  channel?: Channel;
  board: Board;
  ready: boolean;
  started: number;
  incoming?: { chunks: string[]; total: number; bytes: number; id: string };
  outgoing?: Iterator<unknown>;
  recoveryHead?: number;
  retry: number;
};
type Options = { url?: string; relay?: boolean; createSecret?: () => string };
const defaultControls = (): Controls => ({
  question: null,
  questionRevision: 0,
  members: [],
});
// One diagnostics registry across Vite module aliases/HMR; stop() removes references.
const registry = globalThis as typeof globalThis & {
  __whitepadPeers?: Set<PeerClassroomConnection>;
};
const active = (registry.__whitepadPeers ??=
  new Set<PeerClassroomConnection>());
/** In-memory diagnostics; no credentials or SDP returned. Useful to browser test tooling. */
export const activePeerConnections = () => [...active];
export class PeerClassroomConnection implements ClassroomConnection {
  readonly isPeer = true;
  private handlers = new Map<string, Set<(...args: any[]) => void>>();
  private stopped = false;
  private room = "";
  private token = "";
  private id = "";
  private teacher = false;
  private socket?: WebSocket;
  private socketRetry = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private pumpTimer?: ReturnType<typeof setInterval>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private peers = new Map<string, Peer>();
  private members = new Map<string, any>();
  private board: Board = emptyBoard();
  private confirmedSeq = 0;
  private beforeClear?: Board;
  private controls = defaultControls();
  private savedEpoch = 0;
  private savedRevision = 0;
  private questionRevision = 0;
  private ice: RTCIceServer[] = [];
  private iceExpires = 0;
  private lastPong = 0;
  private lastPing = 0;
  private online = false;
  private status = "Connecting";
  private persistenceError = false;
  private url: string;
  private relay: boolean;
  readonly metrics = {
    signallingSent: 0,
    signallingReceived: 0,
    connections: 0,
    closedBytesSent: 0,
    closedBytesReceived: 0,
    signalCloses: {} as Record<string, number>,
    connectionMs: [] as number[],
    recoveries: 0,
    latencyMs: [] as number[],
  };
  constructor(private options: Options = {}) {
    this.url = options.url ?? import.meta.env.VITE_SIGNALLING_URL ?? "";
    this.relay =
      options.relay ?? import.meta.env.VITE_RTC_RELAY_ONLY === "true";
  }
  on(name: string, handler: (...args: any[]) => void) {
    const key = name.toLowerCase();
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    if (key === "transportstatus") handler({ status: this.status });
    if (key === "questionchanged" && this.id)
      handler({ question: this.controls.question, isInitial: true });
    if (key === "studentlocked" && this.id && !this.teacher)
      handler({
        studentId: this.id,
        isLocked:
          !this.online ||
          !!this.controls.members.find((m) => m.id === this.id)?.locked,
      });
  }
  off(name: string, handler?: (...args: any[]) => void) {
    if (handler) this.handlers.get(name.toLowerCase())?.delete(handler);
    else this.handlers.delete(name.toLowerCase());
  }
  private emit = (name: string, data: any) => {
    this.handlers.get(name.toLowerCase())?.forEach((h) => h(data));
  };
  recoveredIndicators() {
    let confidence: "none" | "red" | "amber" | "green" = "none",
      answered = false;
    for (const o of this.board.operations) {
      if (o.body.type === "confidence") confidence = o.body.value;
      if (o.body.type === "answered") answered = o.body.value;
    }
    return { confidence, answered };
  }
  recoveredBoard() {
    return materialise(this.board, this.id);
  }
  private setStatus(status: string) {
    this.status = status;
    this.emit("transportStatus", { status });
  }
  private wake = () => {
    if (document.visibilityState === "visible" && this.id && !this.stopped) {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.wsSend({ type: "ping" });
        for (const [id, p] of this.peers)
          if (p.pc.connectionState !== "connected") this.dropPeer(id);
      } else this.scheduleReconnect();
    }
  };
  async start() {
    if (!this.url) throw new Error("VITE_SIGNALLING_URL is required");
    this.stopped = false;
    active.add(this);
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
  }
  async stop() {
    active.delete(this);
    this.stopped = true;
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.saveTimer);
    clearInterval(this.pumpTimer);
    this.pumpTimer = undefined;
    this.socket?.close();
    for (const id of this.peers.keys()) this.dropPeer(id);
    if (this.id && !this.teacher) await this.persist();
  }
  private async api(
    path: string,
    body: unknown = {},
    token = this.token,
  ): Promise<any> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, {
        method: "POST",
        signal: timeout.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok)
      throw new Error(`Classroom request failed (${response.status})`);
    return response.json();
  }
  async invoke<T = any>(method: string, ...args: any[]): Promise<T> {
    if (method === "CreateRoom")
      return this.api(
        "/create",
        { name: args[0] },
        this.options.createSecret?.() ??
          window.prompt("Teacher room-creation access code") ??
          "",
      );
    if (method === "JoinRoomAsTeacher") {
      this.teacher = true;
      this.room = args[0];
      this.token = args[1];
      this.id = "teacher";
      await this.connectOrRetry();
      return undefined as T;
    }
    if (method === "JoinRoomAsStudent" || method === "ResumeStudentSession") {
      if (this.stopped) await this.start();
      this.room = args[0];
      this.teacher = false;
      const response =
        method === "JoinRoomAsStudent"
          ? await this.api(`/rooms/${this.room}/join`, {
              joinToken: args[1],
              name: args[2],
            })
          : await this.api(`/rooms/${this.room}/session`, {}, args[2]);
      this.id = response.studentId;
      this.token = response.studentSessionToken ?? args[2];
      this.board = emptyBoard();
      this.confirmedSeq = 0;
      this.beforeClear = undefined;
      this.savedEpoch = 0;
      this.savedRevision = 0;
      this.questionRevision = 0;
      try {
        const saved = await loadBoard(`${this.room}:${this.id}`);
        if (saved) {
          this.board = saved.board;
          this.savedEpoch = saved.controlEpoch;
          this.savedRevision = saved.revision;
          this.questionRevision = saved.questionRevision;
          this.confirmedSeq = saved.confirmedSeq ?? 0;
          this.beforeClear =
            saved.beforeClear && validateBoard(saved.beforeClear)
              ? saved.beforeClear
              : undefined;
        }
      } catch {
        this.persistenceError = true;
      }
      this.reconcile(response.control);
      await this.connectOrRetry();
      return { ...response, studentSessionToken: this.token } as T;
    }
    if (this.teacher) {
      const commands: Record<string, string> = {
        LockStudent: "lock",
        UnlockStudent: "unlock",
        LockAllStudents: "lock",
        UnlockAllStudents: "unlock",
        ClearStudentBoard: "clear",
        ClearAllBoards: "clear",
        KickStudent: "kick",
        SetQuestion: "question",
      };
      const command = commands[method];
      if (!command) throw new Error("Unsupported teacher command");
      if (args[0] !== this.room) throw new Error("Room mismatch");
      return this.api(`/rooms/${this.room}/control`, {
        command,
        ...(method === "SetQuestion"
          ? { question: args[1] ?? null }
          : args[1]
            ? { studentId: args[1] }
            : {}),
      });
    }
    if (method === "JoinFromWaitingRoom") return undefined as T;
    const control = this.controls.members.find((m) => m.id === this.id);
    if (
      !control ||
      (control.locked &&
        method !== "SetConfidence" &&
        method !== "SetAnswered") ||
      !this.online
    )
      throw new Error("Drawing paused until classroom controls are reconciled");
    if (method === "SendStrokeBatch") {
      const b = args[0] as StrokeBatch;
      if (!b.points.length) {
        this.commit({
          type: "background",
          pattern: b.backgroundType ?? "none",
          paper: b.paperColor ?? "white",
        });
      } else {
        if (!styleFor(this.board, b.strokeId))
          this.commit({
            type: "start",
            id: b.strokeId,
            style: {
              color: b.color,
              width: Math.abs(b.lineWidth),
              eraser: !!b.isEraser,
            },
          });
        const points = encodePoints(b.points);
        for (let i = 0; i < points.length; i += 256)
          this.commit({
            type: "points",
            id: b.strokeId,
            points: points.slice(i, i + 256),
          });
      }
      if (b.isComplete && styleFor(this.board, b.strokeId))
        this.commit({ type: "end", id: b.strokeId });
    } else if (method === "SendShape") {
      const s = args[0] as Shape;
      this.commit({
        type: "shape",
        id: s.shapeId,
        shape: s.type,
        points: encodePoints(s.points),
        style: { color: s.color, width: Math.abs(s.lineWidth), eraser: false },
      });
    } else if (method === "UndoStroke" || method === "RedoStroke")
      this.commit({
        type: method === "UndoStroke" ? "undo" : "redo",
        id: args[0],
      });
    else if (method === "ClearBoard") {
      const background = this.board.operations
        .filter((o) => o.body.type === "background")
        .at(-1)?.body;
      const confidence = this.board.operations
        .filter((o) => o.body.type === "confidence")
        .at(-1)?.body;
      const answered = this.board.operations
        .filter((o) => o.body.type === "answered")
        .at(-1)?.body;
      this.commit({ type: "clear" });
      for (const body of [background, confidence, answered])
        if (body) this.commit(body);
    } else if (method === "SetConfidence")
      this.commit({ type: "confidence", value: args[0] });
    else if (method === "SetAnswered")
      this.commit({ type: "answered", value: args[0] });
    else throw new Error("Unsupported student operation");
    return undefined as T;
  }
  private commit(body: Body) {
    const op: Operation = {
      v: 1,
      opId: crypto.randomUUID(),
      seq: this.board.seq + 1,
      epoch: this.board.epoch + (body.type === "clear" ? 1 : 0),
      body,
    };
    if (body.type === "clear" && !this.beforeClear)
      this.beforeClear = {
        ...this.board,
        operations: [...this.board.operations],
      };
    try {
      apply(this.board, op);
    } catch (error) {
      if (String(error).includes("Board storage limit"))
        this.emit("boardCapacity", { full: true });
      this.setStatus("Board limit reached — clear to continue");
      throw error;
    }
    const p = this.peers.get("teacher");
    if (p?.ready && !p.outgoing)
      p.channel?.send({
        v: 1,
        type: "op",
        revision: this.savedRevision,
        controlEpoch: this.savedEpoch,
        questionRevision: this.controls.questionRevision,
        sentAt: Date.now(),
        op,
      });
    if (body.type === "clear") this.emit("boardCapacity", { full: false });
    this.scheduleSave(body.type === "end");
  }
  private scheduleSave(immediate = false) {
    if (immediate) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (this.saveTimer === undefined)
      this.saveTimer = setTimeout(
        () => {
          this.saveTimer = undefined;
          void this.persist();
        },
        immediate ? 0 : 150,
      );
  }
  private async persist() {
    try {
      await saveBoard(`${this.room}:${this.id}`, {
        board: this.board,
        controlEpoch: this.savedEpoch,
        revision: this.savedRevision,
        questionRevision: this.questionRevision,
        confirmedSeq: this.confirmedSeq,
        beforeClear: this.beforeClear,
        updated: Date.now(),
      });
    } catch {
      this.persistenceError = true;
      this.setStatus("Connected — local recovery unavailable");
    }
  }
  private async refreshIce() {
    if (Date.now() < this.iceExpires) return;
    const result = await this.api(`/rooms/${this.room}/turn`);
    this.ice = result.iceServers;
    this.iceExpires = (result.expires ?? Date.now() + 3600000) - 600000;
  }
  private async connectOrRetry() {
    try {
      await this.connect();
    } catch (error) {
      if (/\((403|404)\)/.test(String(error))) throw error;
      this.setStatus("Classroom service unavailable — retrying");
      this.scheduleReconnect();
    }
  }
  private async connect() {
    if (this.stopped) return;
    await this.refreshIce();
    const { ticket } = await this.api(`/rooms/${this.room}/ticket`);
    if (this.stopped) return;
    const ws = new WebSocket(
      `${this.url.replace(/^http/, "ws")}/rooms/${this.room}/socket`,
      ["whitepad", ticket],
    );
    this.socket = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("Signalling timed out"));
      }, 15000);
      ws.onmessage = (e) => {
        if (this.socket !== ws) return;
        this.metrics.signallingReceived += e.data.length;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "welcome") {
            clearTimeout(timer);
            this.socketRetry = 0;
            this.lastPong = Date.now();
            this.online = true;
            this.reconcile(msg.control);
            this.setStatus(
              this.persistenceError
                ? "Connected — local recovery unavailable"
                : "Connecting to classroom peers",
            );
            this.updateLock();
            this.startPump();
            resolve();
          } else this.signalMessage(msg);
        } catch {
          ws.close(1008, "Invalid server message");
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Signalling unavailable"));
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        reject(new Error("Signalling closed"));
        if (this.socket !== ws) return;
        const closeKey = String(e.code);
        if (
          Object.keys(this.metrics.signalCloses).length < 20 ||
          closeKey in this.metrics.signalCloses
        )
          this.metrics.signalCloses[closeKey] =
            (this.metrics.signalCloses[closeKey] ?? 0) + 1;
        this.online = false;
        this.updateLock();
        this.setStatus("Disconnected — drawing paused");
        for (const id of this.peers.keys()) this.dropPeer(id);
        if (e.code === 4003) {
          this.emit("kicked", {});
          this.stopped = true;
        } else if (e.code === 4001) {
          this.stopped = true;
          this.setStatus("Session open on another device");
        } else this.scheduleReconnect();
      };
    });
  }
  private scheduleReconnect() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch(() => this.scheduleReconnect());
    }, backoff(this.socketRetry++));
  }
  private signalMessage(msg: any) {
    if (msg.type === "pong") {
      this.lastPong = Date.now();
      return;
    }
    if (msg.type === "kicked") {
      this.stopped = true;
      this.online = false;
      this.updateLock();
      this.emit("kicked", {});
      void this.stop();
      return;
    }
    if (msg.type === "control") {
      this.reconcile(msg.control);
      return;
    }
    if (msg.type === "presence" && this.teacher) {
      const next = new Set<string>();
      for (const m of msg.peers) {
        next.add(m.studentId);
        if (!this.members.has(m.studentId)) this.emit("participantJoined", m);
        this.emit("participantConnection", {
          studentId: m.studentId,
          isConnected: m.online,
        });
        this.members.set(m.studentId, m);
        if (m.online && !this.peers.has(m.studentId))
          void this.offer(m.studentId);
        if (!m.online) {
          this.peers.get(m.studentId)?.pc.close();
          this.peers.delete(m.studentId);
        }
      }
      for (const id of this.members.keys())
        if (!next.has(id)) {
          this.members.delete(id);
          this.peers.get(id)?.pc.close();
          this.peers.delete(id);
          this.emit("participantLeft", { studentId: id, reason: "removed" });
        }
      return;
    }
    if (msg.type === "teacher" && !msg.online && !this.teacher) {
      this.peers.get("teacher")?.pc.close();
      this.peers.delete("teacher");
      this.setStatus("Teacher disconnected — board saved locally");
      return;
    }
    if (msg.type === "signal")
      void this.handleSignal(msg).catch(() => this.dropPeer(msg.from));
  }
  private reconcile(control: Controls) {
    const previous = this.controls;
    this.controls = control;
    if (previous.questionRevision !== control.questionRevision) {
      this.emit("questionChanged", { question: control.question });
      for (const id of this.members.keys())
        this.emit("answeredChanged", { studentId: id, hasAnswered: false });
    }
    if (!this.teacher) {
      const m = control.members.find((x) => x.id === this.id);
      if (!m) return;
      const epochChanged = this.savedEpoch !== m.epoch;
      if (epochChanged) {
        const background = this.board.operations
          .filter((o) => o.body.type === "background")
          .at(-1)?.body;
        this.board = emptyBoard();
        if (background)
          apply(this.board, {
            v: 1,
            opId: crypto.randomUUID(),
            seq: 1,
            epoch: 0,
            body: background,
          });
        this.savedEpoch = m.epoch;
        this.confirmedSeq = 0;
        this.beforeClear = undefined;
        this.emit("boardCleared", { studentId: this.id });
      }
      if (this.savedRevision !== m.revision && !epochChanged) {
        this.board = rewindBoard(
          this.board,
          this.confirmedSeq,
          this.beforeClear,
        );
        this.beforeClear = undefined;
        this.emit("localBoardReconciled", {});
      }
      this.savedRevision = m.revision;
      if (this.questionRevision !== control.questionRevision) {
        this.questionRevision = control.questionRevision; // Old answers cannot apply to a new question.
        if (this.board.operations.length) {
          const op: Operation = {
            v: 1,
            opId: crypto.randomUUID(),
            seq: this.board.seq + 1,
            epoch: this.board.epoch,
            body: { type: "answered", value: false },
          };
          apply(this.board, op);
        }
      }
      void this.persist();
      this.updateLock();
      const p = this.peers.get("teacher");
      if (p?.channel) {
        p.ready = false;
        p.started = performance.now();
        p.outgoing = undefined;
        p.channel.clear();
        this.hello(p, this.id);
      }
    } else {
      for (const m of control.members) {
        this.emit("studentLocked", { studentId: m.id, isLocked: m.locked });
        const old = previous.members.find((x) => x.id === m.id);
        const p = this.peers.get(m.id);
        if (old && old.epoch !== m.epoch) {
          if (p) p.board = emptyBoard();
          this.emit("boardCleared", { studentId: m.id });
        }
        if (
          p?.channel &&
          (!old ||
            old.revision !== m.revision ||
            previous.questionRevision !== control.questionRevision)
        ) {
          if (old && old.revision !== m.revision) {
            p.board = emptyBoard();
            this.emit("boardRecovered", {
              studentId: m.id,
              board: materialise(p.board, m.id),
            });
          }
          p.ready = false;
          p.incoming = undefined;
          this.hello(p, m.id);
        }
      }
    }
  }
  private updateLock() {
    if (!this.teacher)
      this.emit("studentLocked", {
        studentId: this.id,
        isLocked:
          !this.online ||
          !!this.controls.members.find((m) => m.id === this.id)?.locked,
      });
  }
  private wsSend(data: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(data);
    this.metrics.signallingSent += s.length;
    this.socket.send(s);
  }
  private makePeer(id: string, attempt: string): Peer {
    if (this.peers.has(id)) this.dropPeer(id);
    const pc = new RTCPeerConnection({
      iceServers: this.ice,
      iceTransportPolicy: this.relay ? "relay" : "all",
    });
    const peer: Peer = {
      pc,
      attempt,
      board: emptyBoard(),
      ready: false,
      started: performance.now(),
      retry: 0,
    };
    this.peers.set(id, peer);
    if (this.teacher)
      this.emit("boardRecovered", {
        studentId: id,
        board: materialise(peer.board, id),
      });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected") {
        peer.ready = false;
        peer.started = performance.now();
      }
      if (
        ["failed", "closed"].includes(pc.connectionState) &&
        this.peers.get(id) === peer
      )
        this.dropPeer(id);
    };
    return peer;
  }
  private async offer(id: string) {
    if (!this.online || this.stopped) return;
    const peer = this.makePeer(id, crypto.randomUUID());
    try {
      await this.refreshIce();
      peer.pc.setConfiguration({
        iceServers: this.ice,
        iceTransportPolicy: this.relay ? "relay" : "all",
      });
      this.attach(
        id,
        peer,
        peer.pc.createDataChannel("whitepad-v1", { ordered: true }),
      );
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await gather(peer.pc);
      if (this.peers.get(id) === peer)
        this.wsSend({
          type: "signal",
          to: id,
          attempt: peer.attempt,
          description: peer.pc.localDescription,
        });
    } catch {
      this.dropPeer(id);
    }
  }
  private async handleSignal(msg: any) {
    if (this.teacher) {
      const p = this.peers.get(msg.from);
      if (!p || p.attempt !== msg.attempt || msg.description.type !== "answer")
        return;
      await p.pc.setRemoteDescription(msg.description);
    } else {
      if (msg.from !== "teacher" || msg.description.type !== "offer") return;
      const p = this.makePeer("teacher", msg.attempt);
      p.pc.ondatachannel = (e) => {
        if (e.channel.label !== "whitepad-v1" || !e.channel.ordered) {
          e.channel.close();
          return;
        }
        this.attach("teacher", p, e.channel);
      };
      await p.pc.setRemoteDescription(msg.description);
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      await gather(p.pc);
      if (this.peers.get("teacher") === p)
        this.wsSend({
          type: "signal",
          to: "teacher",
          attempt: p.attempt,
          description: p.pc.localDescription,
        });
    }
  }
  private dropPeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    this.metrics.closedBytesSent += p.channel?.bytesSent ?? 0;
    this.metrics.closedBytesReceived += p.channel?.bytesReceived ?? 0;
    p.pc.close();
    if (!this.teacher)
      this.setStatus("Teacher peer reconnecting — board saved locally");
  }
  private attach(id: string, p: Peer, dc: RTCDataChannel) {
    if (p.channel) {
      dc.close();
      return;
    }
    p.channel = new Channel(
      dc,
      (data) => this.receive(id, p, data),
      () => {
        p.ready = false;
        p.started = performance.now();
        p.outgoing = undefined;
        if (this.teacher) this.hello(p, id);
        else
          p.channel?.send({
            v: 1,
            type: "resync",
            revision: this.savedRevision,
            controlEpoch: this.savedEpoch,
            questionRevision: this.controls.questionRevision,
          });
      },
    );
    dc.onopen = () => {
      this.metrics.connections++;
      if (this.metrics.connectionMs.length < 1000)
        this.metrics.connectionMs.push(performance.now() - p.started);
      this.setStatus(
        this.persistenceError
          ? "Connected — local recovery unavailable"
          : "Connected",
      );
      this.hello(p, id === "teacher" ? this.id : id);
    };
    dc.onclose = () => {
      if (this.peers.get(id) === p) this.dropPeer(id);
    };
  }
  private hello(p: Peer, id: string) {
    if (!p.ready) p.started = performance.now();
    const c = this.controls.members.find((m) => m.id === id);
    if (!c) return;
    p.channel?.send({
      v: 1,
      type: "hello",
      revision: c.revision,
      controlEpoch: c.epoch,
      questionRevision: this.controls.questionRevision,
      seq: this.teacher ? p.board.seq : this.board.seq,
    });
  }
  private receive(id: string, p: Peer, msg: any) {
    if (msg.v !== 1 || typeof msg.type !== "string")
      throw new Error("Protocol version");
    const c = this.controls.members.find(
      (m) => m.id === (this.teacher ? id : this.id),
    );
    if (
      !c ||
      msg.revision !== c.revision ||
      msg.controlEpoch !== c.epoch ||
      msg.questionRevision !== this.controls.questionRevision
    )
      return; // Wait for authority reconciliation; never apply an old clear generation.
    p.started = performance.now(); // Valid progress keeps a slow bounded recovery alive.
    if (msg.type === "hello") {
      if (!integer(msg.seq)) throw new Error("Sequence");
      if (this.teacher && p.ready) return;
      p.ready = true;
      p.recoveryHead = msg.seq;
      if (this.teacher) this.hello(p, id);
      else {
        this.hello(p, this.id);
        this.recover(p, msg.seq);
      }
      return;
    }
    if (this.teacher && msg.type === "resync") {
      this.hello(p, id);
      return;
    }
    if (!this.teacher) {
      if (msg.type === "ack" && integer(msg.seq) && msg.seq <= this.board.seq) {
        this.confirmedSeq = Math.max(this.confirmedSeq, msg.seq);
        this.scheduleSave();
        if (this.beforeClear && msg.seq > this.beforeClear.seq)
          this.beforeClear = undefined;
        return;
      }
      throw new Error("Teacher may not write a student board");
    }
    if (!p.ready) return;
    if (msg.type === "op") {
      if (!validOperation(msg.op)) throw new Error("Invalid operation");
      if (
        c.locked &&
        msg.op.seq > (p.recoveryHead ?? 0) &&
        msg.op.body.type !== "confidence" &&
        msg.op.body.type !== "answered"
      )
        return;
      const result = apply(p.board, msg.op);
      if (result === "gap") {
        p.ready = false;
        this.hello(p, id);
        return;
      }
      if (result === "applied") {
        if (
          typeof msg.sentAt === "number" &&
          this.metrics.latencyMs.length < 10000
        )
          this.metrics.latencyMs.push(Date.now() - msg.sentAt);
        operationEvent(msg.op, p.board, id, this.emit);
        p.channel?.send({
          v: 1,
          type: "ack",
          revision: c.revision,
          controlEpoch: c.epoch,
          questionRevision: this.controls.questionRevision,
          seq: p.board.seq,
        });
      }
    } else if (msg.type === "snapshot-start") {
      if (
        !integer(msg.total, 1024) ||
        msg.total < 1 ||
        typeof msg.id !== "string" ||
        msg.id.length > 64
      )
        throw new Error("Snapshot limit");
      p.incoming = { id: msg.id, total: msg.total, chunks: [], bytes: 0 };
    } else if (msg.type === "snapshot-chunk") {
      const s = p.incoming;
      if (
        !s ||
        s.id !== msg.id ||
        msg.index !== s.chunks.length ||
        typeof msg.data !== "string" ||
        msg.data.length > 8000 ||
        s.chunks.length >= s.total
      )
        throw new Error("Snapshot order");
      s.bytes += msg.data.length;
      if (s.bytes > MAX_BOARD_BYTES + 1024) throw new Error("Snapshot limit");
      s.chunks.push(msg.data);
    } else if (msg.type === "snapshot-end") {
      const s = p.incoming;
      if (!s || s.id !== msg.id || s.chunks.length !== s.total)
        throw new Error("Incomplete snapshot");
      const board = JSON.parse(s.chunks.join(""));
      p.incoming = undefined;
      if (
        !validateBoard(board) ||
        board.seq < p.board.seq ||
        (c.locked && board.seq > (p.recoveryHead ?? 0))
      )
        throw new Error("Invalid snapshot");
      p.board = board;
      p.channel?.send({
        v: 1,
        type: "ack",
        revision: c.revision,
        controlEpoch: c.epoch,
        questionRevision: this.controls.questionRevision,
        seq: board.seq,
      });
      this.metrics.recoveries++;
      this.emit("boardRecovered", {
        studentId: id,
        board: materialise(board, id),
      });
      // Recover indicators as well as vector drawing.
      for (const op of board.operations)
        if (op.body.type === "confidence" || op.body.type === "answered")
          operationEvent(op, board, id, this.emit);
    } else throw new Error("Unexpected peer message");
  }
  private recover(p: Peer, after: number) {
    const c = this.controls.members.find((m) => m.id === this.id)!;
    const base: PeerHeader = {
      v: 1,
      revision: c.revision,
      controlEpoch: c.epoch,
      questionRevision: this.controls.questionRevision,
    };
    const operations = this.board.operations.filter((o) => o.seq > after);
    const snapshot = JSON.stringify(this.board);
    const seq = this.board.seq;
    function* frames() {
      if (
        after <= seq &&
        operations.length <= 512 &&
        (!operations.length || operations[0].seq === after + 1)
      ) {
        for (const op of operations) yield { ...base, type: "op", op };
      } else {
        const id = crypto.randomUUID(),
          total = Math.ceil(snapshot.length / 8000);
        yield { ...base, type: "snapshot-start", id, total };
        for (let index = 0; index < total; index++)
          yield {
            ...base,
            type: "snapshot-chunk",
            id,
            index,
            data: snapshot.slice(index * 8000, (index + 1) * 8000),
          };
        yield { ...base, type: "snapshot-end", id };
      }
    }
    p.outgoing = frames();
    // Send operations created during the snapshot after this iterator finishes.
    (p as Peer & { sentSeq?: number }).sentSeq = seq;
  }
  private startPump() {
    if (this.pumpTimer) return;
    this.pumpTimer = setInterval(() => {
      if (this.stopped) return;
      if (this.online && Date.now() - this.lastPing > 20000) {
        if (this.lastPing && Date.now() - this.lastPong > 60000) {
          this.socket?.close();
          return;
        }
        this.lastPing = Date.now();
        this.wsSend({ type: "ping" });
      }
      if (this.teacher && this.online)
        for (const [id, m] of this.members) {
          if (m.online && !this.peers.has(id)) {
            // Space retries globally and jitter per peer.
            const at = m.retryAt ?? 0;
            if (Date.now() > at) {
              m.failures = (m.failures ?? 0) + 1;
              m.retryAt = Date.now() + backoff(m.failures);
              void this.offer(id);
            }
          }
        }
      for (const [id, p] of this.peers) {
        if (!p.ready && performance.now() - p.started > 30000) {
          this.dropPeer(id);
          continue;
        }
        if (p.channel && p.ready && p.outgoing && p.channel.pending < 65536) {
          for (let n = 0; n < 8 && p.channel.pending < 65536; n++) {
            const next = p.outgoing.next();
            if (next.done) {
              p.outgoing = undefined;
              const sent = (p as Peer & { sentSeq?: number }).sentSeq ?? 0;
              if (!this.teacher && this.board.seq > sent) this.recover(p, sent);
              break;
            }
            p.channel.send(next.value);
          }
        }
      }
    }, 100);
  }
  async stats() {
    const peers = [];
    for (const [id, p] of this.peers) {
      const stats = await p.pc.getStats();
      let selected: any;
      stats.forEach((r) => {
        if (r.type === "transport" && r.selectedCandidatePairId)
          selected = stats.get(r.selectedCandidatePairId);
      });
      const local = selected ? stats.get(selected.localCandidateId) : undefined,
        remote = selected ? stats.get(selected.remoteCandidateId) : undefined;
      peers.push({
        id,
        state: p.pc.connectionState,
        relayed:
          local?.candidateType === "relay" || remote?.candidateType === "relay",
        bytesSent: p.channel?.bytesSent ?? 0,
        bytesReceived: p.channel?.bytesReceived ?? 0,
        peakBuffered: p.channel?.peakBuffered ?? 0,
        rtt: selected?.currentRoundTripTime,
      });
    }
    return {
      ...this.metrics,
      online: this.online,
      status: this.status,
      applicationBytesSent:
        this.metrics.closedBytesSent +
        peers.reduce((n, p) => n + p.bytesSent, 0),
      applicationBytesReceived:
        this.metrics.closedBytesReceived +
        peers.reduce((n, p) => n + p.bytesReceived, 0),
      peers,
    };
  }
}
