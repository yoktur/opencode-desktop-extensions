import {
  createOpencodeClient,
  type OpencodeClient,
} from "@opencode-ai/sdk/client";
import { createCell } from "./state";
import type {
  Dispose,
  OpenCodeConnection,
  OpenCodeDesktop,
  OpenCodeSDK,
} from "./types";

type DesktopBridge = {
  awaitInitialization(): Promise<{
    url: string;
    username: string | null;
    password: string | null;
  }>;
};

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
  const clients = new Map<string, Promise<OpencodeClient>>();

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
      const key = `${resolved.key}\0${options.directory ?? ""}`;
      let client = clients.get(key);
      if (!client) {
        client = Promise.resolve(
          createOpencodeClient({
            baseUrl: resolved.url,
            directory: options.directory,
            headers:
              resolved.username && resolved.password
                ? {
                    Authorization: `Basic ${btoa(`${resolved.username}:${resolved.password}`)}`,
                  }
                : undefined,
          }),
        );
        clients.set(key, client);
      }
      return client;
    },
  };
}

async function resolveSidecar(): Promise<OpenCodeConnection> {
  const bridge = (window as unknown as { api?: DesktopBridge }).api;
  if (!bridge) throw new Error("OpenCode Desktop preload API is unavailable");
  const server = await bridge.awaitInitialization();
  return {
    key: "sidecar",
    url: server.url,
    username: server.username ?? undefined,
    password: server.password ?? undefined,
  };
}
