import { readFile } from "node:fs/promises";
import { attachDesktopExtension } from "../../src/live";

export default async function liveAttachDemoPlugin() {
  const source = await readFile(new URL("./desktop.js", import.meta.url), "utf8");
  const runtimeSource = await readFile(
    new URL("./runtime.js", import.meta.url),
    "utf8",
  );
  await attachDesktopExtension(
    { id: "live-attach-demo", source },
    { runtimeSource },
  );
  return {};
}
