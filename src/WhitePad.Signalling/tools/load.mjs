// Real Chromium RTCPeerConnections + production React teacher grid, via Vite's development modules.
// No credentials, raw candidates, SDP or board contents are written to the report.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const rooms = Number(process.env.ROOMS ?? 15),
  participants = Number(process.env.PARTICIPANTS ?? 400);
const seconds = Number(process.env.SECONDS ?? 120),
  duty = Number(process.env.DUTY ?? 0.25);
const web = process.env.WEB_URL ?? "http://localhost:5173",
  signalling = process.env.SIGNALLING_URL ?? "http://localhost:8787";
const code = process.env.CREATE_ROOM_SECRET;
if (!code) throw Error("Set CREATE_ROOM_SECRET in your environment");
if (
  rooms < 1 ||
  participants <= rooms ||
  participants > rooms * 29 ||
  seconds < 1 ||
  duty <= 0 ||
  duty > 1
)
  throw Error("Invalid scale/duty parameters");
const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const report = {
  rooms,
  participants,
  seconds,
  duty,
  relayOnly: process.env.RELAY_ONLY === "true",
  teachers: [],
  students: [],
  errors: [],
  started: new Date().toISOString(),
};
const pages = [];
try {
  for (let r = 0; r < rooms; r++) {
    const res = await fetch(signalling + "/create", {
      method: "POST",
      headers: {
        Origin: web,
        Authorization: `Bearer ${code}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `Load classroom ${r + 1}` }),
    });
    if (!res.ok) throw Error(`Room creation failed: ${res.status}`);
    const room = await res.json();
    const context = await browser.newContext(),
      teacher = await context.newPage(),
      students = await context.newPage();
    teacher.on("pageerror", () => report.errors.push("teacher-page-error"));
    students.on("pageerror", () => report.errors.push("student-page-error"));
    await teacher.goto(web);
    await teacher.evaluate((room) => {
      sessionStorage.setItem(
        `whitepad:teacherToken:${room.roomId}`,
        room.teacherToken,
      );
      sessionStorage.setItem(
        "whitepad:teacherRoom:v1",
        JSON.stringify({ session: room, expires: Date.now() + 86400000 }),
      );
    }, room);
    await teacher.reload();
    await teacher
      .getByRole("button", { name: "Switch to Teacher Viewer Mode" })
      .click();
    await teacher.evaluate(() => {
      window.renderMetrics = { frames: 0, slowFrames: 0, longTasks: 0 };
      let last = performance.now();
      function frame(now) {
        window.renderMetrics.frames++;
        if (now - last > 50) window.renderMetrics.slowFrames++;
        last = now;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      new PerformanceObserver((list) => {
        window.renderMetrics.longTasks += list.getEntries().length;
      }).observe({ type: "longtask", buffered: true });
    });
    const cdp = await context.newCDPSession(teacher);
    await cdp.send("Performance.enable");
    const baseline = await cdp.send("Performance.getMetrics");
    await students.goto(web);
    const count =
      Math.floor((participants - rooms) / rooms) +
      (r < (participants - rooms) % rooms ? 1 : 0);
    await students.evaluate(
      async ({ room, count, signalling, relay }) => {
        const { PeerClassroomConnection } =
          await import("/src/p2p/connection.ts");
        window.clients = [];
        for (let i = 0; i < count; i++) {
          const c = new PeerClassroomConnection({ url: signalling, relay });
          await c.start();
          await c.invoke(
            "JoinRoomAsStudent",
            room.roomId,
            room.joinToken,
            `Student ${i + 1}`,
          );
          window.clients.push(c);
        }
      },
      { room, count, signalling, relay: report.relayOnly },
    );
    pages.push({ teacher, students, cdp, baseline, count });
  }
  for (const { students, count } of pages)
    await students.waitForFunction(
      async (count) =>
        (await Promise.all(window.clients.map((c) => c.stats()))).filter((s) =>
          s.peers.some((p) => p.state === "connected"),
        ).length === count,
      count,
      { timeout: 60000 },
    );
  report.establishedAt = new Date().toISOString();
  for (const { students } of pages)
    await students.evaluate(
      ({ seconds, duty }) => {
        const start = performance.now();
        let tick = 0;
        window.drawingErrors = 0;
        window.drawingTimer = setInterval(() => {
          const now = performance.now();
          if (now - start > seconds * 1000) {
            clearInterval(window.drawingTimer);
            return;
          }
          const t = tick++;
          window.clients.forEach((c, i) => {
            const active = (t + i * 7) % 100 < Math.ceil(duty * 100);
            const prior = (t - 1 + i * 7) % 100 < Math.ceil(duty * 100);
            if (!active) {
              if (prior && c.loadStroke)
                c.invoke("SendStrokeBatch", {
                  ...c.loadStroke,
                  points: [],
                  isComplete: true,
                }).catch(() => window.drawingErrors++);
              c.loadStroke = undefined;
              return;
            }
            if (!c.loadStroke || t % 10 === 0) {
              if (c.loadStroke)
                c.invoke("SendStrokeBatch", {
                  ...c.loadStroke,
                  points: [],
                  isComplete: true,
                }).catch(() => window.drawingErrors++);
              c.loadStroke = {
                studentId: "",
                strokeId: crypto.randomUUID(),
                color: "#000000",
                lineWidth: 2,
                isComplete: false,
              };
            }
            const points = Array.from({ length: 6 }, (_, j) => ({
              x: ((t * 6 + j) % 600) / 600,
              y: 0.5 + Math.sin((t * 6 + j) / 10) * 0.3,
              pressure: 0.5,
            }));
            c.invoke("SendStrokeBatch", { ...c.loadStroke, points }).catch(
              () => window.drawingErrors++,
            );
          });
        }, 100);
      },
      { seconds, duty },
    );
  await new Promise((resolve) => setTimeout(resolve, (seconds + 2) * 1000));
  for (const { teacher, students, cdp, baseline, count } of pages) {
    const after = await cdp.send("Performance.getMetrics");
    const metric = (data, name) =>
      data.metrics.find((m) => m.name === name)?.value ?? 0;
    const ts = await teacher.evaluate(async () => {
      const { activePeerConnections } = await import("/src/p2p/connection.ts");
      return {
        transport: await Promise.all(
          activePeerConnections().map((c) => c.stats()),
        ),
        render: window.renderMetrics,
        canvases: document.querySelectorAll("canvas").length,
      };
    });
    report.teachers.push({
      ...ts,
      expectedBoards: count,
      taskCpuSeconds:
        metric(after, "TaskDuration") - metric(baseline, "TaskDuration"),
      heapBytes: metric(after, "JSHeapUsedSize"),
    });
    report.students.push(
      await students.evaluate(async () => ({
        errors: window.drawingErrors,
        transport: await Promise.all(window.clients.map((c) => c.stats())),
      })),
    );
  }
  const transports = report.students.flatMap((s) => s.transport);
  const peers = transports.flatMap((s) => s.peers);
  const latency = report.teachers
    .flatMap((t) => t.transport.flatMap((c) => c.latencyMs))
    .sort((a, b) => a - b);
  const bytes = transports.reduce(
    (n, c) =>
      n +
      (c.applicationBytesSent ?? c.peers.reduce((a, p) => a + p.bytesSent, 0)),
    0,
  );
  report.summary = {
    connected: peers.filter((p) => p.state === "connected").length,
    expected: participants - rooms,
    relayed: peers.filter((p) => p.relayed).length,
    applicationBytes: bytes,
    bytesPerActiveDrawingMinute:
      bytes / ((((participants - rooms) * seconds) / 60) * duty),
    oneWayLatencyMs: {
      p50: latency[Math.floor(latency.length * 0.5)] ?? null,
      p95: latency[Math.floor(latency.length * 0.95)] ?? null,
      samples: latency.length,
    },
    signallingBytes:
      transports.reduce(
        (n, s) => n + s.signallingSent + s.signallingReceived,
        0,
      ) +
      report.teachers.reduce(
        (n, t) =>
          n +
          t.transport.reduce(
            (a, s) => a + s.signallingSent + s.signallingReceived,
            0,
          ),
        0,
      ),
    drawingErrors: report.students.reduce((n, s) => n + s.errors, 0),
  };
  await writeFile(
    process.env.REPORT ?? "load-results.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report.summary, null, 2));
  if (
    report.summary.connected !== report.summary.expected ||
    report.summary.drawingErrors ||
    report.errors.length
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
