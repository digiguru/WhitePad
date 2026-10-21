import { DurableObject } from "cloudflare:workers";
import { creationQuota, type CreationCounter } from "./creationQuota";
import { identifier, type Controls } from "../../WhitePad.Web/src/p2p/protocol";
interface Env {
  ROOMS: DurableObjectNamespace<Classroom>;
  ALLOWED_ORIGINS: string;
  WEB_ORIGIN: string;
  CREATE_ROOM_SECRET: string;
  TURN_KEY_ID: string;
  TURN_API_TOKEN: string;
  LOCAL_DIRECT_ONLY?: string;
}
type Member = {
  id: string;
  tokenHash: string;
  name: string;
  locked: boolean;
  kicked: boolean;
  epoch: number;
  revision: number;
  connectedAt: string;
};
type Room = {
  id: string;
  name: string;
  teacherHash: string;
  joinHash: string;
  expires: number;
  question: string | null;
  questionRevision: number;
  members: Member[];
  defaultLocked: boolean;
};
type Identity = { id: string; role: "teacher" | "student" };
type Attachment = Identity & { attempt: string; minute: number; count: number };
const json = (x: unknown, status = 200) =>
  Response.json(x, { status, headers: { "Cache-Control": "no-store" } });
const secret = () => crypto.randomUUID() + crypto.randomUUID();
async function hash(x: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
const fail = () => {
  throw new Error("Rejected");
};
export function permittedSignal(from: Identity, to: string, members: Member[]) {
  return from.role === "teacher"
    ? members.some((m) => m.id === to && !m.kicked)
    : to === "teacher" && members.some((m) => m.id === from.id && !m.kicked);
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    if (!env.ALLOWED_ORIGINS.split(",").includes(origin))
      return json({ error: "Origin rejected" }, 403);
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Expose-Headers": "Retry-After",
      Vary: "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers });
    const url = new URL(req.url);
    const match = url.pathname.match(
      /^\/rooms\/([a-zA-Z0-9_-]{1,128})\/(join|session|ticket|socket|turn|control)$/,
    );
    let res: Response;
    if (url.pathname === "/create" && req.method === "POST") {
      if (
        !env.CREATE_ROOM_SECRET ||
        (await hash(req.headers.get("Authorization") ?? "")) !==
          (await hash(`Bearer ${env.CREATE_ROOM_SECRET}`))
      )
        return json({ error: "Unauthorised" }, 403);
      res = await env.ROOMS.getByName("creation-quota").fetch(req);
    } else if (match) res = await env.ROOMS.getByName(match[1]).fetch(req);
    else res = json({ error: "Not found" }, 404);
    if (res.status === 101) return res;
    const out = new Response(res.body, res);
    Object.entries(headers).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
} satisfies ExportedHandler<Env>;
export class Classroom extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        return await this.handle(req);
      } catch {
        return json({ error: "Request rejected" }, 403);
      }
    });
  }
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url),
      action = url.pathname.split("/").pop();
    // Bound the body while reading, before allocating an arbitrarily large string.
    let raw = "";
    if (req.method === "POST" && req.body) {
      const reader = req.body.getReader();
      let bytes = 0;
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8192) {
          await reader.cancel();
          return json({ error: "Too large" }, 413);
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    }
    if (raw.length > 8192) return json({ error: "Too large" }, 413);
    const body = raw ? JSON.parse(raw) : {};
    if (action === "create") {
      const quota = creationQuota(
        req.url, this.env.WEB_ORIGIN, Date.now(),
        await this.ctx.storage.get<CreationCounter>("quota"),
      );
      if (!quota.allowed)
        return Response.json(
          { error: "Creation quota", code: "creation_quota", retryAt: quota.retryAt },
          { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(quota.retryAfter) } },
        );
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 100
      )
        fail();
      await this.ctx.storage.put("quota", quota.next);
      const id = crypto.randomUUID();
      return this.env.ROOMS.getByName(id).initialise(id, body.name);
    }
    const room = await this.ctx.storage.get<Room>("room");
    if (!room || room.expires < Date.now())
      return json({ error: "Room expired" }, 404);
    const minute = Math.floor(Date.now() / 60000),
      rate = await this.ctx.storage.get<{ minute: number; count: number }>(
        "rate",
      );
    if (rate?.minute === minute && rate.count >= 300)
      return json({ error: "Rate limit" }, 429);
    await this.ctx.storage.put("rate", {
      minute,
      count: rate?.minute === minute ? rate.count + 1 : 1,
    });
    if (action === "join" && req.method === "POST") {
      if (
        typeof body.joinToken !== "string" ||
        (await hash(body.joinToken)) !== room.joinHash ||
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 60 ||
        room.members.length >= 28
      )
        fail();
      const token = secret();
      const member: Member = {
        id: crypto.randomUUID(),
        tokenHash: await hash(token),
        name: body.name.trim(),
        locked: room.defaultLocked,
        kicked: false,
        epoch: 0,
        revision: 0,
        connectedAt: new Date().toISOString(),
      };
      room.members.push(member);
      await this.ctx.storage.put("room", room);
      return json({
        ...this.session(room, member),
        studentSessionToken: token,
      });
    }
    if (action === "socket" && req.headers.get("Upgrade") === "websocket") {
      const ticket = req.headers
        .get("Sec-WebSocket-Protocol")
        ?.split(",")
        .map((x) => x.trim())[1];
      if (!ticket) fail();
      const key = `ticket:${await hash(ticket!)}`;
      const saved = await this.ctx.storage.get<Identity & { expires: number }>(
        key,
      );
      await this.ctx.storage.delete(key);
      if (
        !saved ||
        saved.expires < Date.now() ||
        (saved.role === "student" &&
          !room.members.some((m) => m.id === saved.id && !m.kicked))
      )
        fail();
      const who = saved!;
      for (const old of this.ctx.getWebSockets(who.id))
        old.close(4001, "Session replaced");
      const pair = new WebSocketPair();
      const ws = pair[1];
      this.ctx.acceptWebSocket(ws, [who.id]);
      ws.serializeAttachment({
        ...who,
        attempt: crypto.randomUUID(),
        minute,
        count: 0,
      });
      this.send(ws, {
        type: "welcome",
        identity: who,
        control: this.control(room, who),
        peers:
          who.role === "teacher"
            ? room.members
                .filter((m) => !m.kicked)
                .map((m) => this.publicMember(m))
            : [],
      });
      this.notifyPresence(room);
      return new Response(null, {
        status: 101,
        webSocket: pair[0],
        headers: { "Sec-WebSocket-Protocol": "whitepad" },
      });
    }
    const token =
      req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const digest = await hash(token);
    const member = room.members.find(
      (m) => m.tokenHash === digest && !m.kicked,
    );
    const who: Identity =
      digest === room.teacherHash
        ? { id: "teacher", role: "teacher" }
        : member
          ? { id: member.id, role: "student" }
          : fail();
    if (action === "session")
      return json(
        who.role === "teacher"
          ? { control: this.control(room, who) }
          : this.session(room, member!),
      );
    if (action === "ticket") {
      const tickets = await this.ctx.storage.list<
        Identity & { expires: number }
      >({ prefix: "ticket:" });
      for (const [key, value] of tickets)
        if (value.expires < Date.now() || value.id === who.id)
          await this.ctx.storage.delete(key);
      const ticket = secret();
      await this.ctx.storage.put(`ticket:${await hash(ticket)}`, {
        ...who,
        expires: Date.now() + 30000,
      });
      return json({ ticket });
    }
    if (action === "turn") {
      const key = `turn:${who.id}`;
      const cached = await this.ctx.storage.get<{
        expires: number;
        iceServers: unknown;
      }>(key);
      if (cached && cached.expires > Date.now() + 600000) return json(cached);
      if (
        this.env.LOCAL_DIRECT_ONLY === "true" &&
        new URL(this.env.WEB_ORIGIN).hostname === "localhost"
      )
        return json({ iceServers: [] });
      if (!this.env.TURN_KEY_ID || !this.env.TURN_API_TOKEN)
        return json({ error: "TURN not configured" }, 503);
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.TURN_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ttl: 7200 }),
        },
      );
      if (!response.ok) return json({ error: "TURN unavailable" }, 503);
      const result = (await response.json()) as {
        iceServers: {
          urls: string | string[];
          username?: string;
          credential?: string;
        }[];
      };
      if (!Array.isArray(result.iceServers))
        return json({ error: "Invalid TURN configuration" }, 503);
      const iceServers = result.iceServers
        .map((server) => ({
          ...server,
          urls: (Array.isArray(server.urls)
            ? server.urls
            : [server.urls]
          ).filter((url) => !/:53(?:\?|$)/.test(url)),
        }))
        .filter((server) => server.urls.length);
      const value = { iceServers, expires: Date.now() + 7200000 };
      await this.ctx.storage.put(key, value);
      return json(value);
    }
    if (
      action === "control" &&
      req.method === "POST" &&
      who.role === "teacher"
    ) {
      if (
        !["lock", "unlock", "clear", "kick", "question"].includes(body.command)
      )
        fail();
      if (body.command === "question") {
        if (
          body.question !== null &&
          (typeof body.question !== "string" || body.question.length > 280)
        )
          fail();
        room.question = body.question;
        room.questionRevision++;
      } else {
        if (
          body.studentId !== undefined &&
          !room.members.some((m) => m.id === body.studentId && !m.kicked)
        )
          fail();
        if (body.command === "kick" && !body.studentId) fail();
        for (const m of room.members.filter(
          (m) => !body.studentId || m.id === body.studentId,
        )) {
          m.revision++;
          if (body.command === "lock" || body.command === "unlock")
            m.locked = body.command === "lock";
          if (body.command === "clear") m.epoch++;
          if (body.command === "kick") m.kicked = true;
        }
        if (
          !body.studentId &&
          (body.command === "lock" || body.command === "unlock")
        )
          room.defaultLocked = body.command === "lock";
      }
      const removed = room.members.filter((m) => m.kicked).map((m) => m.id);
      room.members = room.members.filter((m) => !m.kicked);
      await this.ctx.storage.put("room", room); // Persist before acknowledging or broadcasting authority.
      for (const id of removed) {
        await this.ctx.storage.delete([
          `attempt:${id}`,
          `turn:${id}`,
          `signal-rate:${id}`,
        ]);
        const tickets = await this.ctx.storage.list<Identity>({
          prefix: "ticket:",
        });
        for (const [key, ticket] of tickets)
          if (ticket.id === id) await this.ctx.storage.delete(key);
      }
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment;
        if (removed.includes(a.id)) {
          this.send(ws, { type: "kicked" });
          ws.close(4003, "Removed");
        } else
          this.send(ws, { type: "control", control: this.control(room, a) });
      }
      this.notifyPresence(room);
      return json({ ok: true });
    }
    return json({ error: "Operation rejected" }, 403);
  }
  async initialise(id: string, name: string) {
    const teacherToken = secret(),
      joinToken = secret();
    const room: Room = {
      id,
      name,
      teacherHash: await hash(teacherToken),
      joinHash: await hash(joinToken),
      expires: Date.now() + 86400000,
      question: null,
      questionRevision: 0,
      members: [],
      defaultLocked: false,
    };
    await this.ctx.storage.put("room", room);
    await this.ctx.storage.setAlarm(room.expires);
    return json({
      roomId: id,
      roomName: name,
      teacherToken,
      joinToken,
      joinUrl: `${this.env.WEB_ORIGIN}/join?roomId=${id}&token=${joinToken}&transport=webrtc`,
      createdAt: new Date().toISOString(),
    });
  }
  publicMember(m: Member) {
    return {
      studentId: m.id,
      displayName: m.name,
      isLocked: m.locked,
      connectedAt: m.connectedAt,
      inputMode: "pen",
    };
  }
  control(r: Room, who: Identity): Controls {
    return {
      question: r.question,
      questionRevision: r.questionRevision,
      members: r.members
        .filter((m) => !m.kicked && (who.role === "teacher" || m.id === who.id))
        .map((m) => ({
          id: m.id,
          locked: m.locked,
          epoch: m.epoch,
          revision: m.revision,
        })),
    };
  }
  session(r: Room, m: Member) {
    return {
      success: true,
      studentId: m.id,
      displayName: m.name,
      isLocked: m.locked,
      currentQuestion: r.question,
      waitingRoomEnabled: false,
      waitingRoomUnlocked: true,
      control: this.control(r, { id: m.id, role: "student" }),
    };
  }
  send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      ws.close(1011, "Reconnect");
    }
  }
  notifyPresence(r: Room) {
    for (const ws of this.ctx.getWebSockets("teacher")) {
      this.send(ws, {
        type: "control",
        control: this.control(r, { id: "teacher", role: "teacher" }),
      });
      this.send(ws, {
        type: "presence",
        peers: r.members
          .filter((m) => !m.kicked)
          .map((m) => ({
            ...this.publicMember(m),
            online: this.ctx
              .getWebSockets(m.id)
              .some((s) => s.readyState === 1),
          })),
      });
    }
    for (const m of r.members.filter((m) => !m.kicked))
      for (const ws of this.ctx.getWebSockets(m.id))
        this.send(ws, {
          type: "teacher",
          online: this.ctx
            .getWebSockets("teacher")
            .some((s) => s.readyState === 1),
        });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const room = await this.ctx.storage.get<Room>("room");
        if (!room || room.expires < Date.now()) fail();
        if (typeof message !== "string" || message.length > 32768) fail();
        const a = ws.deserializeAttachment() as Attachment,
          minute = Math.floor(Date.now() / 60000);
        a.count = a.minute === minute ? a.count + 1 : 1;
        a.minute = minute;
        ws.serializeAttachment(a);
        const rateKey = `signal-rate:${a.id}`;
        const persisted = await this.ctx.storage.get<{
          minute: number;
          count: number;
        }>(rateKey);
        const count = persisted?.minute === minute ? persisted.count + 1 : 1;
        await this.ctx.storage.put(rateKey, { minute, count });
        if (
          count > 240 ||
          a.count > 240 ||
          (a.role === "student" &&
            !room!.members.some((m) => m.id === a.id && !m.kicked))
        )
          fail();
        const msg = JSON.parse(message as string);
        if (msg.type === "ping") {
          this.send(ws, { type: "pong" });
          return;
        }
        if (
          msg.type !== "signal" ||
          !identifier(msg.to) ||
          !identifier(msg.attempt) ||
          !permittedSignal(a, msg.to, room!.members)
        )
          fail();
        // Only the teacher creates offers. Non-trickle ICE keeps one bounded SDP per negotiation.
        if (
          !msg.description ||
          msg.description.type !==
            (a.role === "teacher" ? "offer" : "answer") ||
          typeof msg.description.sdp !== "string" ||
          msg.description.sdp.length > 24000
        )
          fail();
        const student = a.role === "teacher" ? msg.to : a.id;
        const attemptKey = `attempt:${student}`;
        if (a.role === "teacher")
          await this.ctx.storage.put(attemptKey, msg.attempt);
        else if ((await this.ctx.storage.get(attemptKey)) !== msg.attempt)
          fail();
        for (const target of this.ctx.getWebSockets(msg.to))
          this.send(target, {
            type: "signal",
            from: a.id,
            attempt: msg.attempt,
            description: msg.description,
          });
      } catch {
        ws.close(1008, "Protocol rejected");
      }
    });
  }
  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {}
    const room = await this.ctx.storage.get<Room>("room");
    if (room) this.notifyPresence(room);
  }
  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) ws.close(4003, "Room expired");
    await this.ctx.storage.deleteAll();
  }
}
