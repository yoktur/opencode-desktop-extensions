import { readFile } from "node:fs/promises";
import { attachDesktopExtension } from "../../src/live";

async function bootstrap() {
  const source = await readFile(new URL("./desktop.js", import.meta.url), "utf8");
  const runtimeSource = await readFile(
    new URL("./runtime.js", import.meta.url),
    "utf8",
  );
  await attachDesktopExtension(
    { id: "live-attach-demo", source },
    { runtimeSource },
  );
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
