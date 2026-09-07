import { OpenCode, type OpenCodeClient } from "@opencode-ai/client";
import { createCell } from "./state";
import type {
  Dispose,
  OpenCodeConnection,
  OpenCodeDesktop,
  OpenCodeSDK,
} from "./types";

export function createOpenCodeSDK(
  desktop: OpenCodeDesktop,
  own: (dispose: Dispose) => Dispose,
): OpenCodeSDK {
  const active = () =>
    desktop.tabs.snapshot().find((tab) => tab.active)?.session;
  const currentSession = createCell(active());
  own(
    desktop.tabs.subscribe((tabs) =>
      currentSession.set(tabs.find((tab) => tab.active)?.session),
    ),
  );

  let sidecar: Promise<OpenCodeConnection> | undefined;
  const clients = new Map<string, OpenCodeClient>();

  const connection = async (
    server = currentSession.get()?.server ?? "sidecar",
  ) => {
    if (server === "sidecar") {
      sidecar ??= resolveSidecar();
      return sidecar;
    }
    if (server.startsWith("http://") || server.startsWith("https://")) {
      return { key: server, url: server };
    }
    throw new Error(
      `OCDX cannot resolve credentials for OpenCode server "${server}"`,
    );
  };

  return {
    currentSession,
    connection,
    async client(options = {}) {
      const resolved = await connection(options.server);
      const existing = clients.get(resolved.key);
      if (existing) return existing;
      const client = OpenCode.make({
        baseUrl: resolved.url,
        headers:
          resolved.username && resolved.password
            ? {
                Authorization: `Basic ${btoa(`${resolved.username}:${resolved.password}`)}`,
              }
            : undefined,
      });
      clients.set(resolved.key, client);
      return client;
    },
  };
}

async function resolveSidecar(): Promise<OpenCodeConnection> {
  const response = await fetch("ocdx://host/connection");
  if (!response.ok) throw new Error("The OCDX background service is not ready");
  return response.json();
}
