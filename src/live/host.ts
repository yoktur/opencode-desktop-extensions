type LiveExtensionPayload = {
  id: string;
  source: string;
  digest: string;
};

type LiveHostPayload = {
  runtimeSource: string;
  extension: LiveExtensionPayload;
  rendererURLPrefixes: string[];
};

export function createLiveHostExpression(payload: LiveHostPayload) {
  return `
    (async () => {
      const Module = process.getBuiltinModule("module");
      const require = Module.createRequire(process.execPath);
      const electron = require("electron");
      return await (${installLiveHost.toString()})(electron, ${JSON.stringify(payload)});
    })()
    //# sourceURL=ocdx-live-bootstrap.js
  `;
}

// This function is serialized into the inspector evaluation. Keep it self-contained.
export async function installLiveHost(electron: any, payload: LiveHostPayload) {
  const root = globalThis as any;
  const current = root.__ocdxLiveHost;
  if (current) {
    if (current.schema !== 1 || typeof current.register !== "function") {
      throw new Error("An incompatible OCDX live host is already installed");
    }
    return current.register(payload.extension);
  }

  const { app, BrowserWindow } = electron;
  if (!app || !BrowserWindow || typeof BrowserWindow.getAllWindows !== "function") {
    throw new Error("The target is not an Electron main process");
  }

  const extensions = new Map<string, LiveExtensionPayload>();
  const watchers = new Map<number, any>();
  const injected = new Map<number, Map<string, string>>();
  const queues = new Map<number, Promise<void>>();
  let disposed = false;

  const isTarget = (contents: any) => {
    if (!contents || contents.isDestroyed?.()) return false;
    const url = contents.getURL?.() ?? "";
    return payload.rendererURLPrefixes.some((prefix) => url.startsWith(prefix));
  };

  const execute = (contents: any, source: string) =>
    contents.executeJavaScript(source, true);

  const inject = (contents: any, onlyID?: string) => {
    const id = Number(contents.id);
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (disposed || !isTarget(contents)) return;
      const hasRuntime = await execute(
        contents,
        "Boolean(globalThis.__ocdx)",
      );
      if (!hasRuntime) {
        await execute(
          contents,
          `${payload.runtimeSource}\n//# sourceURL=ocdx-runtime.js`,
        );
      }
      const state = injected.get(id) ?? new Map<string, string>();
      injected.set(id, state);
      const selected = onlyID
        ? [extensions.get(onlyID)].filter(Boolean)
        : [...extensions.values()];
      for (const extension of selected as LiveExtensionPayload[]) {
        if (state.get(extension.id) === extension.digest) continue;
        const extensionID = JSON.stringify(extension.id);
        try {
          await execute(
            contents,
            `globalThis.__ocdx?.disable(${extensionID});\n${extension.source}\n//# sourceURL=ocdx-live-${extension.id}.js`,
          );
          state.set(extension.id, extension.digest);
        } catch (error) {
          await execute(contents, `globalThis.__ocdx?.disable(${extensionID})`).catch(
            () => undefined,
          );
          state.delete(extension.id);
          throw error;
        }
      }
    });
    queues.set(id, next.catch(() => undefined));
    return next;
  };

  const watch = (contents: any) => {
    const id = Number(contents.id);
    if (!Number.isFinite(id) || watchers.has(id)) return;
    const reload = () => {
      injected.delete(id);
      void inject(contents).catch((error) =>
        console.error("[ocdx-live] renderer injection failed", error),
      );
    };
    const destroy = () => {
      contents.removeListener?.("dom-ready", reload);
      contents.removeListener?.("destroyed", destroy);
      watchers.delete(id);
      injected.delete(id);
      queues.delete(id);
    };
    contents.on?.("dom-ready", reload);
    contents.on?.("destroyed", destroy);
    watchers.set(id, { contents, reload, destroy });
    if (isTarget(contents)) reload();
  };

  const created = (_event: unknown, contents: any) => watch(contents);
  app.on("web-contents-created", created);
  for (const window of BrowserWindow.getAllWindows()) watch(window.webContents);

  const host = {
    schema: 1,
    extensions,
    async register(extension: LiveExtensionPayload) {
      if (disposed) throw new Error("The OCDX live host has been disposed");
      if (!extension?.id || !extension.source || !extension.digest) {
        throw new Error("Invalid OCDX live extension registration");
      }
      const existing = extensions.get(extension.id);
      if (existing?.digest === extension.digest) {
        return { status: "unchanged", id: extension.id };
      }
      extensions.set(extension.id, extension);
      await Promise.all(
        [...watchers.values()].map(({ contents }) => inject(contents, extension.id)),
      );
      return {
        status: existing ? "updated" : "registered",
        id: extension.id,
      };
    },
    async unregister(extensionID: string) {
      if (!extensions.delete(extensionID)) return false;
      const source = `globalThis.__ocdx?.disable(${JSON.stringify(extensionID)})`;
      await Promise.allSettled(
        [...watchers.values()].map(async ({ contents }) => {
          if (!isTarget(contents)) return;
          await execute(contents, source);
          injected.get(Number(contents.id))?.delete(extensionID);
        }),
      );
      return true;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      app.removeListener("web-contents-created", created);
      for (const { contents, reload, destroy } of watchers.values()) {
        contents.removeListener?.("dom-ready", reload);
        contents.removeListener?.("destroyed", destroy);
      }
      await Promise.allSettled(
        [...watchers.values()].map(({ contents }) =>
          isTarget(contents)
            ? execute(contents, "globalThis.__ocdx?.dispose()")
            : Promise.resolve(),
        ),
      );
      watchers.clear();
      injected.clear();
      queues.clear();
      extensions.clear();
      if (root.__ocdxLiveHost === host) delete root.__ocdxLiveHost;
    },
  };

  root.__ocdxLiveHost = host;
  try {
    return await host.register(payload.extension);
  } catch (error) {
    await host.dispose();
    throw error;
  }
}
