import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:5173",
    headless: true,
  },
  reporter: "list",
});
