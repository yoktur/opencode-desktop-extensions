import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "*.spec.ts",
  use: { baseURL: "http://127.0.0.1:4599", channel: "chrome" },
  webServer: {
    command: "bunx vite --host 127.0.0.1 --port 4599 --strictPort",
    url: "http://127.0.0.1:4599/test/fixture.html",
  },
});
