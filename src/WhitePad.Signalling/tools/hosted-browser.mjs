// Opt-in built-frontend acceptance. No traces, screenshots or sensitive logging.
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
const web = process.env.WEB_URL;
if (!web || new URL(web).protocol !== "https:")
  throw Error("Set WEB_URL to the HTTPS frontend");
const local = process.env.CREATE_ROOM_SECRET
  ? {}
  : parseEnv(await readFile(".dev.vars", "utf8"));
const secret = process.env.CREATE_ROOM_SECRET ?? local.CREATE_ROOM_SECRET;
if (!secret) throw Error("Configure CREATE_ROOM_SECRET privately");
const browser = await chromium.launch();
let phase = "room creation";
try {
  const tc = await browser.newContext(),
    sc = await browser.newContext();
  const teacher = await tc.newPage(),
    student = await sc.newPage();
  teacher.setDefaultTimeout(45000);
  student.setDefaultTimeout(45000);
  teacher.on("dialog", (d) =>
    d.type() === "prompt" ? d.accept(secret) : d.dismiss(),
  );
  await teacher.goto(web + "/teacher");
  await teacher
    .getByRole("button", { name: "Create Room", exact: true })
    .click();
  await teacher.getByLabel("Room Name").fill("Hosted acceptance");
  await teacher.locator("button[type=submit]").click();
  await teacher.locator(".join-url-small").waitFor();
  const join = await teacher.locator(".join-url-small").textContent();
  if (
    new URL(join).origin !== new URL(web).origin ||
    !join.includes("transport=webrtc")
  )
    throw Error("Join destination");
  console.log("PASS: published UI creates a WebRTC classroom");
  phase = "student joining";
  await student.goto(join);
  await student.getByPlaceholder(/name/i).fill("Hosted Test Student");
  await student.getByRole("button", { name: /join/i }).click();
  await teacher.getByRole("button", { name: /Teacher Viewer/ }).click();
  await expect(student.getByRole("status")).toHaveText("Connected", {
    timeout: 45000,
  });
  await teacher.getByText("Hosted Test Student", { exact: true }).waitFor();
  const ink = () =>
    teacher
      .locator("canvas")
      .first()
      .evaluate((c) => {
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] < 100 && d[i + 3] > 0) n++;
        return n;
      });
  phase = "drawing delivery";
  const b = await student.locator("canvas").last().boundingBox();
  await student.mouse.move(b.x + 100, b.y + 100);
  await student.mouse.down();
  await student.mouse.move(b.x + 200, b.y + 180, { steps: 20 });
  await student.mouse.up();
  await expect.poll(ink, { timeout: 45000 }).toBeGreaterThan(0);
  console.log("PASS: drawing reaches the real teacher canvas");
  phase = "student refresh";
  await student.reload();
  await expect(student.getByRole("status")).toHaveText("Connected", {
    timeout: 45000,
  });
  await expect
    .poll(
      () =>
        student
          .locator("canvas")
          .last()
          .evaluate((c) => {
            const d = c
              .getContext("2d")
              .getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
            return n;
          }),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
  console.log("PASS: student refresh recovers ink and reconnects");
  phase = "teacher refresh";
  await teacher.reload();
  const viewer = teacher.getByRole("button", { name: /Teacher Viewer/ });
  if (await viewer.isVisible()) await viewer.click();
  await teacher.getByText("Hosted Test Student", { exact: true }).waitFor();
  await expect.poll(ink, { timeout: 45000 }).toBeGreaterThan(0);
  console.log("PASS: teacher refresh recovers the student board");
} catch {
  console.error("FAIL: hosted acceptance at " + phase);
  process.exitCode = 1;
} finally {
  await browser.close();
}
