import { readFile } from "node:fs/promises";
import { attachDesktopExtension } from "../../src/live";

let pending: Promise<void> | undefined;

function bootstrap() {
  pending ??= run().finally(() => {
    setTimeout(() => {
      pending = undefined;
    }, 1_000);
  });
  return pending;
}

async function run() {
  const source = await readFile(new URL("./desktop.js", import.meta.url), "utf8");
  const runtimeSource = await readFile(
    new URL("./runtime.js", import.meta.url),
    "utf8",
  );
  const result = await attachDesktopExtension(
    { id: "live-attach-demo", source },
    { runtimeSource },
  );
  if (result.status === "failed") throw new Error(result.reason);
}

export default {
  id: "ocdx-live-demo",
  async setup() {
    await bootstrap();
  },
  async server() {
    await bootstrap();
    return {};
  },
};
