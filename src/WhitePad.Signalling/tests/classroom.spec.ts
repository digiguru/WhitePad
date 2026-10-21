import { test, expect, Page } from "@playwright/test";
const signalling = process.env.SIGNALLING_URL ?? "http://localhost:8787";
const web = process.env.WEB_URL ?? "http://localhost:5173";
const code = process.env.CREATE_ROOM_SECRET ?? "local-test-only";
async function request(path: string, token: string, body: any = {}) {
  return fetch(signalling + path, {
    method: "POST",
    headers: {
      Origin: web,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
async function create() {
  const r = await request("/create", code, { name: "Browser test" });
  expect(r.ok).toBeTruthy();
  return r.json();
}
async function client(
  page: Page,
  teacher: boolean,
  room: any,
  name = "Student",
) {
  await page.goto("/");
  await page.evaluate(
    async ({ teacher, room, signalling, name }) => {
      const { PeerClassroomConnection } = await import(
        "/src/p2p/connection.ts" as string
      );
      const c = new PeerClassroomConnection({
        url: signalling,
        relay: new URL(location.href).searchParams.has("relay"),
      });
      (window as any).client = c;
      (window as any).events = [];
      for (const event of [
        "participantJoined",
        "receiveStrokeBatch",
        "boardRecovered",
        "studentLocked",
        "boardCleared",
        "questionChanged",
        "answeredChanged",
      ])
        c.on(event, (data: any) =>
          (window as any).events.push({ event, data }),
        );
      await c.start();
      (window as any).session = teacher
        ? await c.invoke("JoinRoomAsTeacher", room.roomId, room.teacherToken)
        : await c.invoke(
            "JoinRoomAsStudent",
            room.roomId,
            room.joinToken,
            name,
          );
    },
    { teacher, room, signalling, name },
  );
}
async function connected(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (await (window as any).client.stats()).peers.filter(
              (p: any) => p.state === "connected",
            ).length,
        ),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
}
async function stroke(page: Page, id = "stroke-test") {
  await page.evaluate(async (id) => {
    await (window as any).client.invoke("SendStrokeBatch", {
      strokeId: id,
      studentId: "forged-id",
      points: [
        { x: 0.1, y: 0.1, pressure: 0.5 },
        { x: 0.8, y: 0.8, pressure: 1 },
      ],
      color: "#000000",
      lineWidth: 2,
      isComplete: true,
    });
  }, id);
}
test("room isolation, role rejection, no join-token session access, and origin checks", async () => {
  const a = await create(),
    b = await create();
  expect(
    (await request(`/rooms/${a.roomId}/session`, a.joinToken)).status,
  ).toBe(403);
  expect(
    (await request(`/rooms/${b.roomId}/session`, a.teacherToken)).status,
  ).toBe(403);
  const joined = await (
    await request(`/rooms/${a.roomId}/join`, "", {
      joinToken: a.joinToken,
      name: "Student",
    })
  ).json();
  expect(
    (
      await request(`/rooms/${a.roomId}/control`, joined.studentSessionToken, {
        command: "clear",
        role: "teacher",
      })
    ).status,
  ).toBe(403);
  expect(
    (await request(`/rooms/${a.roomId}/ticket`, b.teacherToken)).status,
  ).toBe(403);
  const origin = await fetch(signalling + `/rooms/${a.roomId}/session`, {
    method: "POST",
    headers: {
      Origin: "https://attacker.example",
      Authorization: `Bearer ${a.teacherToken}`,
    },
  });
  expect(origin.status).toBe(403);
});
test("real data channels, identity binding, undo/redo, teacher refresh and student local recovery", async ({
  browser,
}) => {
  const room = await create();
  const tc = await browser.newContext(),
    sc = await browser.newContext();
  const teacher = await tc.newPage(),
    student = await sc.newPage();
  await client(teacher, true, room);
  await client(student, false, room);
  await connected(student);
  await stroke(student);
  await expect
    .poll(() =>
      teacher.evaluate(
        () =>
          (window as any).events.filter(
            (e: any) => e.event === "receiveStrokeBatch",
          ).length,
      ),
    )
    .toBe(1);
  const sid = await student.evaluate(() => (window as any).session.studentId);
  expect(
    await teacher.evaluate(
      () =>
        (window as any).events.find(
          (e: any) => e.event === "receiveStrokeBatch",
        ).data.studentId,
    ),
  ).toBe(sid);
  await student.evaluate(async () => {
    await (window as any).client.invoke("UndoStroke", "stroke-test");
    await (window as any).client.invoke("RedoStroke", "stroke-test");
  });
  await expect
    .poll(() =>
      teacher.evaluate(
        () =>
          (window as any).events
            .filter((e: any) => e.event === "boardRecovered")
            .at(-1)?.data.board.drawOrder,
      ),
    )
    .toEqual(["stroke-test"]);
  await teacher.evaluate(() => (window as any).client.stop());
  await client(teacher, true, room);
  await connected(student);
  await expect
    .poll(() =>
      teacher.evaluate(() =>
        (window as any).events.some(
          (e: any) =>
            e.event === "receiveStrokeBatch" ||
            (e.event === "boardRecovered" && e.data.board.drawOrder.length > 0),
        ),
      ),
    )
    .toBe(true);
  const token = await student.evaluate(
    () => (window as any).session.studentSessionToken,
  );
  await student.evaluate(() => (window as any).client.stop());
  await student.reload();
  await student.evaluate(
    async ({ room, token, signalling }) => {
      const { PeerClassroomConnection } = await import(
        "/src/p2p/connection.ts" as string
      );
      const c = new PeerClassroomConnection({ url: signalling });
      (window as any).client = c;
      await c.start();
      await c.invoke(
        "ResumeStudentSession",
        room.roomId,
        room.joinToken,
        token,
      );
    },
    { room, token, signalling },
  );
  expect(
    await student.evaluate(
      () => (window as any).client.recoveredBoard().drawOrder,
    ),
  ).toEqual(["stroke-test"]);
  await connected(student);
  await tc.close();
  await sc.close();
});
test("offline clear/lock/question reconcile before any old board is sent", async ({
  browser,
}) => {
  const room = await create(),
    tc = await browser.newContext(),
    sc = await browser.newContext();
  const teacher = await tc.newPage(),
    student = await sc.newPage();
  await client(teacher, true, room);
  await client(student, false, room);
  await connected(student);
  await stroke(student);
  const session = await student.evaluate(() => (window as any).session);
  await student.evaluate(() => (window as any).client.stop());
  for (const command of ["lock", "clear"])
    expect(
      (
        await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
          command,
          studentId: session.studentId,
        })
      ).ok,
    ).toBe(true);
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "question",
    question: "New question",
  });
  await student.reload();
  await student.evaluate(
    async ({ room, session, signalling }) => {
      const { PeerClassroomConnection } = await import(
        "/src/p2p/connection.ts" as string
      );
      const c = new PeerClassroomConnection({ url: signalling });
      (window as any).client = c;
      await c.start();
      (window as any).restored = await c.invoke(
        "ResumeStudentSession",
        room.roomId,
        room.joinToken,
        session.studentSessionToken,
      );
    },
    { room, session, signalling },
  );
  expect(await student.evaluate(() => (window as any).restored.isLocked)).toBe(
    true,
  );
  expect(
    await student.evaluate(
      () => (window as any).client.recoveredBoard().drawOrder,
    ),
  ).toEqual([]);
  expect(
    await student.evaluate(async () => {
      try {
        await (window as any).client.invoke("ClearBoard");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await tc.close();
  await sc.close();
});
test("chunked snapshot recovery beyond replay window", async ({ browser }) => {
  const room = await create(),
    tc = await browser.newContext(),
    sc = await browser.newContext();
  const teacher = await tc.newPage(),
    student = await sc.newPage();
  await client(student, false, room);
  await student.evaluate(async () => {
    for (let i = 0; i < 550; i++)
      await (window as any).client.invoke(
        "SetConfidence",
        i % 2 ? "green" : "amber",
      );
  });
  await client(teacher, true, room);
  await connected(student);
  await expect
    .poll(
      () =>
        teacher.evaluate(
          async () => (await (window as any).client.stats()).recoveries,
        ),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  await tc.close();
  await sc.close();
});
test("existing React UI renders student strokes and recovers after refresh", async ({
  browser,
}) => {
  const room = await create(),
    tc = await browser.newContext(),
    sc = await browser.newContext();
  const teacher = await tc.newPage(),
    student = await sc.newPage();
  await teacher.goto("/");
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
  await student.goto(room.joinUrl);
  await student.getByPlaceholder(/name/i).fill("UI Student");
  await student.getByRole("button", { name: /join/i }).click();
  await expect(student.getByRole("status")).toHaveText("Connected", {
    timeout: 30000,
  });
  await teacher
    .getByRole("button", { name: /view|dashboard|start/i })
    .first()
    .click();
  const canvas = student.locator("canvas").last();
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  await student.mouse.move(bounds!.x + 100, bounds!.y + 100);
  await student.mouse.down();
  await student.mouse.move(bounds!.x + 200, bounds!.y + 180, { steps: 20 });
  await student.mouse.up();
  await expect(teacher.getByText("UI Student", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      teacher
        .locator("canvas")
        .first()
        .evaluate((canvas: any) => {
          const data = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let dark = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i] < 100 && data[i + 3] > 0) dark++;
          return dark;
        }),
    )
    .toBeGreaterThan(0);
  await student.reload();
  await expect(student.getByRole("status")).toHaveText("Connected", {
    timeout: 30000,
  });
  await expect
    .poll(() =>
      student
        .locator("canvas")
        .last()
        .evaluate((canvas: any) => {
          const data = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) ink++;
          return ink;
        }),
    )
    .toBeGreaterThan(0);
  await tc.close();
  await sc.close();
});
test("student socket cannot signal another student or discover another board", async ({
  browser,
}) => {
  const room = await create(),
    other = await create();
  const page = await browser.newPage();
  await page.goto("/");
  const a = await (
    await request(`/rooms/${room.roomId}/join`, "", {
      joinToken: room.joinToken,
      name: "A",
    })
  ).json();
  const b = await (
    await request(`/rooms/${other.roomId}/join`, "", {
      joinToken: other.joinToken,
      name: "B",
    })
  ).json();
  const { ticket } = await (
    await request(`/rooms/${room.roomId}/ticket`, a.studentSessionToken)
  ).json();
  const result = await page.evaluate(
    ({ ticket, room, signalling, target }) =>
      new Promise<any>((resolve, reject) => {
        const ws = new WebSocket(
          `${signalling.replace(/^http/, "ws")}/rooms/${room.roomId}/socket`,
          ["whitepad", ticket],
        );
        let peers: any;
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === "welcome") {
            peers = msg.peers;
            ws.send(
              JSON.stringify({
                type: "signal",
                to: target,
                role: "teacher",
                attempt: "forged-attempt",
                description: { type: "offer", sdp: "forged" },
              }),
            );
          }
        };
        ws.onclose = (e) => resolve({ code: e.code, peers });
        ws.onerror = () => reject(Error("Socket setup failed"));
      }),
    { ticket, room, signalling, target: b.studentId },
  );
  expect(result.code).toBe(1008);
  expect(result.peers).toEqual([]);
  await page.close();
});
test("live lock rejects additional drawing and kick revokes the session", async ({
  browser,
}) => {
  const room = await create(),
    tc = await browser.newContext(),
    sc = await browser.newContext(),
    teacher = await tc.newPage(),
    student = await sc.newPage();
  await client(teacher, true, room);
  await client(student, false, room);
  await connected(student);
  await stroke(student);
  const session = await student.evaluate(() => (window as any).session);
  await expect
    .poll(() => student.evaluate(() => (window as any).client.confirmedSeq))
    .toBeGreaterThan(0);
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "lock",
    studentId: session.studentId,
  });
  await expect
    .poll(() =>
      student.evaluate(
        () =>
          (window as any).events
            .filter((e: any) => e.event === "studentLocked")
            .at(-1)?.data.isLocked,
      ),
    )
    .toBe(true);
  expect(
    await student.evaluate(async () => {
      try {
        await (window as any).client.invoke("ClearBoard");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  // A modified client must not be able to publish ordinary post-lock operations to the teacher.
  await student.evaluate(() => {
    const c = (window as any).client,
      p = c.peers.get("teacher");
    p.channel.send({
      v: 1,
      type: "op",
      revision: c.savedRevision,
      controlEpoch: c.savedEpoch,
      questionRevision: c.controls.questionRevision,
      op: {
        v: 1,
        opId: "forged-post-lock",
        seq: c.board.seq + 1,
        epoch: c.board.epoch,
        body: { type: "clear" },
      },
    });
  });
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "unlock",
    studentId: session.studentId,
  });
  await expect
    .poll(() =>
      student.evaluate(
        () =>
          (window as any).events
            .filter((e: any) => e.event === "studentLocked")
            .at(-1)?.data.isLocked,
      ),
    )
    .toBe(false);
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "kick",
    studentId: session.studentId,
  });
  expect(
    (
      await request(
        `/rooms/${room.roomId}/session`,
        session.studentSessionToken,
      )
    ).status,
  ).toBe(403);
  expect(
    (await request(`/rooms/${room.roomId}/turn`, session.studentSessionToken))
      .status,
  ).toBe(403);
  await tc.close();
  await sc.close();
});
test("forced relay establishes real peers when TURN credentials are configured", async ({
  browser,
}) => {
  test.skip(
    process.env.TEST_TURN !== "true",
    "Requires server-side TURN credentials; never substitute a mock relay",
  );
  const room = await create(),
    tc = await browser.newContext(),
    sc = await browser.newContext(),
    teacher = await tc.newPage(),
    student = await sc.newPage();
  for (const [page, isTeacher] of [
    [teacher, true],
    [student, false],
  ] as const) {
    await page.goto("/");
    await page.evaluate(
      async ({ room, isTeacher, signalling }) => {
        const { PeerClassroomConnection } = await import(
          "/src/p2p/connection.ts" as string
        );
        const c = new PeerClassroomConnection({ url: signalling, relay: true });
        (window as any).client = c;
        (window as any).events = [];
        c.on("receiveStrokeBatch", (data: any) =>
          (window as any).events.push({ event: "receiveStrokeBatch", data }),
        );
        await c.start();
        (window as any).session = isTeacher
          ? await c.invoke("JoinRoomAsTeacher", room.roomId, room.teacherToken)
          : await c.invoke(
              "JoinRoomAsStudent",
              room.roomId,
              room.joinToken,
              "Relay student",
            );
      },
      { room, isTeacher, signalling },
    );
  }
  await connected(student);
  await stroke(student);
  expect(
    await student.evaluate(
      async () => (await (window as any).client.stats()).peers[0].relayed,
    ),
  ).toBe(true);
  await expect
    .poll(() => teacher.evaluate(() => (window as any).events.length))
    .toBeGreaterThan(0);
  await tc.close();
  await sc.close();
});
test("duplicated and delayed operations cannot resurrect a teacher-cleared board", async ({
  browser,
}) => {
  const room = await create(),
    tc = await browser.newContext(),
    sc = await browser.newContext(),
    teacher = await tc.newPage(),
    student = await sc.newPage();
  await client(teacher, true, room);
  await client(student, false, room);
  await connected(student);
  await stroke(student);
  await expect
    .poll(() =>
      teacher.evaluate(
        () =>
          (window as any).events.filter(
            (e: any) => e.event === "receiveStrokeBatch",
          ).length,
      ),
    )
    .toBe(1);
  await student.evaluate(() => {
    const c = (window as any).client;
    (window as any).oldDelivery = {
      revision: c.savedRevision,
      controlEpoch: c.savedEpoch,
      questionRevision: c.controls.questionRevision,
      operations: structuredClone(c.board.operations),
    };
    for (const op of c.board.operations)
      c.peers.get("teacher").channel.send({
        v: 1,
        type: "op",
        revision: c.savedRevision,
        controlEpoch: c.savedEpoch,
        questionRevision: c.controls.questionRevision,
        op,
      });
  });
  const session = await student.evaluate(() => (window as any).session);
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "clear",
    studentId: session.studentId,
  });
  await expect
    .poll(() => student.evaluate(() => (window as any).client.savedEpoch))
    .toBe(1);
  await student.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 100));
    const c = (window as any).client,
      old = (window as any).oldDelivery;
    for (const op of old.operations)
      c.peers.get("teacher").channel.send({
        v: 1,
        type: "op",
        revision: old.revision,
        controlEpoch: old.controlEpoch,
        questionRevision: old.questionRevision,
        op,
      });
  });
  await stroke(student, "after-clear");
  await expect
    .poll(() =>
      teacher.evaluate(() => {
        const c = (window as any).client;
        return [...c.peers.values()].flatMap((p: any) =>
          p.board.operations
            .filter((o: any) => o.body.type === "start")
            .map((o: any) => o.body.id),
        );
      }),
    )
    .toEqual(["after-clear"]);
  await tc.close();
  await sc.close();
});
test("overflowed slow sender recovers its canonical board through a real peer", async ({
  browser,
}) => {
  const room = await create(),
    tc = await browser.newContext(),
    sc = await browser.newContext(),
    teacher = await tc.newPage(),
    student = await sc.newPage();
  await client(teacher, true, room);
  await client(student, false, room);
  await connected(student);
  await student.evaluate(async () => {
    const c = (window as any).client,
      p = c.peers.get("teacher");
    p.started = performance.now() - 60000;
    let blocked = true;
    Object.defineProperty(p.channel.rtc, "bufferedAmount", {
      configurable: true,
      get: () => (blocked ? 300000 : 0),
    });
    for (let i = 0; i < 2200; i++)
      await c.invoke("SetConfidence", i % 2 ? "green" : "amber");
    blocked = false;
    p.channel.rtc.onbufferedamountlow(new Event("bufferedamountlow"));
  });
  await expect
    .poll(
      () =>
        teacher.evaluate(() => {
          const c = (window as any).client;
          return [...c.peers.values()].map((p: any) => p.board.seq).at(0);
        }),
      { timeout: 30000 },
    )
    .toBe(2200);
  await tc.close();
  await sc.close();
});
test("a repeated question resets answers and locked confidence remains usable", async ({
  browser,
}) => {
  const room = await create(),
    tc = await browser.newContext(),
    sc = await browser.newContext(),
    teacher = await tc.newPage(),
    student = await sc.newPage();
  await client(teacher, true, room);
  await client(student, false, room);
  await connected(student);
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "question",
    question: "Same question",
  });
  await expect
    .poll(() =>
      student.evaluate(() => (window as any).client.controls.questionRevision),
    )
    .toBe(1);
  await student.evaluate(() =>
    (window as any).client.invoke("SetAnswered", true),
  );
  await expect
    .poll(() =>
      teacher.evaluate(
        () =>
          (window as any).events
            .filter((e: any) => e.event === "answeredChanged")
            .at(-1)?.data.hasAnswered,
      ),
    )
    .toBe(true);
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "question",
    question: "Same question",
  });
  await expect
    .poll(() =>
      teacher.evaluate(
        () =>
          (window as any).events
            .filter((e: any) => e.event === "answeredChanged")
            .at(-1)?.data.hasAnswered,
      ),
    )
    .toBe(false);
  const session = await student.evaluate(() => (window as any).session);
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "lock",
    studentId: session.studentId,
  });
  await expect
    .poll(() =>
      student.evaluate(() => (window as any).client.controls.members[0].locked),
    )
    .toBe(true);
  await student.evaluate(async () => {
    await (window as any).client.invoke("SetConfidence", "green");
    await (window as any).client.invoke("SetAnswered", true);
  });
  await expect
    .poll(() =>
      teacher.evaluate(
        () =>
          (window as any).events
            .filter((e: any) => e.event === "answeredChanged")
            .at(-1)?.data.hasAnswered,
      ),
    )
    .toBe(true);
  await tc.close();
  await sc.close();
});
test("kicking revokes a session and frees an enrolment slot at room capacity", async () => {
  const room = await create();
  let first: any;
  for (let i = 0; i < 28; i++) {
    const member = await (
      await request(`/rooms/${room.roomId}/join`, "", {
        joinToken: room.joinToken,
        name: `Student ${i}`,
      })
    ).json();
    first ??= member;
  }
  expect(
    (
      await request(`/rooms/${room.roomId}/join`, "", {
        joinToken: room.joinToken,
        name: "Overflow",
      })
    ).status,
  ).toBe(403);
  await request(`/rooms/${room.roomId}/control`, room.teacherToken, {
    command: "kick",
    studentId: first.studentId,
  });
  expect(
    (await request(`/rooms/${room.roomId}/session`, first.studentSessionToken))
      .status,
  ).toBe(403);
  expect(
    (
      await request(`/rooms/${room.roomId}/join`, "", {
        joinToken: room.joinToken,
        name: "Replacement",
      })
    ).status,
  ).toBe(200);
});
