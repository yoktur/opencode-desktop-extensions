import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createLiveHostExpression } from "./host";
import { InspectorSession, discoverInspector, waitForInspector } from "./inspector";
import {
  findOpenCodeDesktopMain,
  verifyOpenCodeDesktopBundle,
} from "./process";

export interface LiveDesktopExtension {
  id: string;
  source: string;
}

export interface LiveAttachOptions {
  runtimeSource?: string;
  rendererURLPrefixes?: string[];
  log?: (message: string) => void;
}

export type LiveAttachResult =
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string }
  | {
      status: "registered" | "updated" | "unchanged";
      extensionID: string;
      electronPID: number;
      inspectorPort: number;
      openedInspector: boolean;
    };

export async function attachDesktopExtension(
  extension: LiveDesktopExtension,
  options: LiveAttachOptions = {},
): Promise<LiveAttachResult> {
  const log = options.log ?? ((message) => console.error(`[ocdx-live] ${message}`));
  if (process.env.OPENCODE_CLIENT !== "desktop") {
    const reason = "OPENCODE_CLIENT is not desktop";
    log(reason);
    return { status: "skipped", reason };
  }
  if (process.platform !== "darwin") {
    const reason = "live attach currently supports macOS only";
    log(reason);
    return { status: "skipped", reason };
  }
  if (!extension.id || !extension.source) {
    return { status: "failed", reason: "extension id and source are required" };
  }

  try {
    const target = await findOpenCodeDesktopMain();
    if (!target) {
      throw new Error(
        "OpenCode Desktop Electron main process was not uniquely identified",
      );
    }
    if (!(await verifyOpenCodeDesktopBundle(target))) {
      throw new Error("OpenCode Desktop process failed app bundle verification");
    }

    let inspector = await discoverInspector(target.pid);
    const openedInspector = !inspector;
    if (!inspector) {
      process.kill(target.pid, "SIGUSR1");
      inspector = await waitForInspector(target.pid);
    }
    if (!inspector) {
      throw new Error("OpenCode Desktop did not expose a PID-owned Node inspector endpoint");
    }

    const runtimeSource =
      options.runtimeSource ??
      (await readFile(
        new URL(/* @vite-ignore */ "./runtime.js", import.meta.url),
        "utf8",
      ));
    const digest = createHash("sha256").update(extension.source).digest("hex");
    const session = await InspectorSession.connect(inspector);
    try {
      const result = (await session.evaluate(
        createLiveHostExpression({
          runtimeSource,
          extension: { ...extension, digest },
          rendererURLPrefixes: options.rendererURLPrefixes ?? ["oc://renderer/"],
        }),
      )) as { status?: LiveAttachResult["status"] } | undefined;
      const status = result?.status;
      if (status !== "registered" && status !== "updated" && status !== "unchanged") {
        throw new Error("The Electron-main host returned an invalid registration result");
      }
      return {
        status,
        extensionID: extension.id,
        electronPID: target.pid,
        inspectorPort: inspector.port,
        openedInspector,
      };
    } finally {
      if (openedInspector) {
        await session.scheduleClose().catch((error) =>
          log(
            `could not schedule inspector shutdown: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
      session.close();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(reason);
    return { status: "failed", reason };
  }
}

export { createLiveHostExpression, installLiveHost } from "./host";
export {
  findOpenCodeDesktopMain,
  isOpenCodeDesktopMain,
  verifyOpenCodeDesktopBundle,
} from "./process";
