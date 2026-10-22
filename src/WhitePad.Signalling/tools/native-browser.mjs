// One-native/one-browser acceptance; no traces, credentials, SDP or candidate logging.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
const web = process.env.WEB_URL,
  signalling = process.env.SIGNALLING_URL,
  binary = process.env.NATIVE_PEER_BINARY;
if (!web || !signalling || !binary)
  throw Error("Set WEB_URL, SIGNALLING_URL and NATIVE_PEER_BINARY");
const local = process.env.CREATE_ROOM_SECRET
  ? {}
  : parseEnv(await readFile(".dev.vars", "utf8"));
const secret = process.env.CREATE_ROOM_SECRET ?? local.CREATE_ROOM_SECRET;
const browser = await chromium.launch();
let child;
let phase = "room authentication";
try {
  const response = await fetch(signalling + "/create", {
    method: "POST",
    redirect: "error",
    headers: {
      Origin: web,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Native compatibility" }),
  });
  if (!response.ok) throw Error("Create rejected");
  const room = await response.json();
  const teacher = await browser.newPage();
  await teacher.goto(web + "/teacher");
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
  await teacher.getByRole("button", { name: /Teacher Viewer/ }).click();
  phase = "native peer";
  child = spawn(
    binary,
    [resolve("../WhitePad.iPad/WhitePad.iPad/Resources/whitepad-protocol.js")],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let marker = false,
    carry = "";
  child.stdout.on("data", (b) => {
    carry = (carry + b.toString()).slice(-128);
    if (carry.includes("NATIVE_DRAWING_SENT")) marker = true;
  });
  child.stderr.on("data", () => {});
  const completed = new Promise((resolve) => {
    child.on("error", () => resolve(-1));
    child.on("exit", resolve);
  });
  child.stdin.end(
    JSON.stringify({
      origin: web,
      endpoint: signalling,
      room: room.roomId,
      join: room.joinToken,
      relay: process.env.RELAY_ONLY ?? "false",
    }) + "\n",
  );
  await expect(
    teacher.getByText("Native fixture", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect
    .poll(
      () =>
        teacher
          .locator("canvas")
          .first()
          .evaluate((c) => {
            const d = c
              .getContext("2d")
              .getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4)
              if (d[i] < 100 && d[i + 3] > 0) n++;
            return n;
          }),
      { timeout: 60000 },
    )
    .toBeGreaterThan(0);
  let timer;
  const result = await Promise.race([
    completed,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(-1), 65000);
    }),
  ]);
  clearTimeout(timer);
  if (result !== 0 || !marker) throw Error("Native fixture incomplete");
  console.log(
    "PASS: native Swift/libwebrtc drawing rendered on browser teacher" +
      (process.env.RELAY_ONLY === "true"
        ? " with native relay-only policy"
        : ""),
  );
} catch {
  console.error("FAIL: native/browser compatibility at " + phase);
  process.exitCode = 1;
} finally {
  child?.kill("SIGTERM");
  await browser.close();
}
