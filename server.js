// @bun
// examples/live-plugin/server.ts
import { readFile as readFile2 } from "fs/promises";

// src/live/index.ts
import { createHash } from "crypto";
import { readFile } from "fs/promises";

// src/live/host.ts
function createLiveHostExpression(payload) {
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
async function installLiveHost(electron, payload) {
  const root = globalThis;
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
  const extensions = new Map;
  const watchers = new Map;
  const injected = new Map;
  const queues = new Map;
  let disposed = false;
  const isTarget = (contents) => {
    if (!contents || contents.isDestroyed?.())
      return false;
    const url = contents.getURL?.() ?? "";
    return payload.rendererURLPrefixes.some((prefix) => url.startsWith(prefix));
  };
  const execute = (contents, source) => contents.executeJavaScript(source, true);
  const inject = (contents, onlyID) => {
    const id = Number(contents.id);
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (disposed || !isTarget(contents))
        return;
      const hasRuntime = await execute(contents, "Boolean(globalThis.__ocdx)");
      if (!hasRuntime) {
        await execute(contents, `${payload.runtimeSource}
//# sourceURL=ocdx-runtime.js`);
      }
      const state = injected.get(id) ?? new Map;
      injected.set(id, state);
      const selected = onlyID ? [extensions.get(onlyID)].filter(Boolean) : [...extensions.values()];
      for (const extension of selected) {
        if (state.get(extension.id) === extension.digest)
          continue;
        const extensionID = JSON.stringify(extension.id);
        try {
          await execute(contents, `globalThis.__ocdx?.disable(${extensionID});
${extension.source}
//# sourceURL=ocdx-live-${extension.id}.js`);
          state.set(extension.id, extension.digest);
        } catch (error) {
          await execute(contents, `globalThis.__ocdx?.disable(${extensionID})`).catch(() => {
            return;
          });
          state.delete(extension.id);
          throw error;
        }
      }
    });
    queues.set(id, next.catch(() => {
      return;
    }));
    return next;
  };
  const watch = (contents) => {
    const id = Number(contents.id);
    if (!Number.isFinite(id) || watchers.has(id))
      return;
    const reload = () => {
      injected.delete(id);
      inject(contents).catch((error) => console.error("[ocdx-live] renderer injection failed", error));
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
    if (isTarget(contents))
      reload();
  };
  const created = (_event, contents) => watch(contents);
  app.on("web-contents-created", created);
  for (const window of BrowserWindow.getAllWindows())
    watch(window.webContents);
  const host = {
    schema: 1,
    extensions,
    async register(extension) {
      if (disposed)
        throw new Error("The OCDX live host has been disposed");
      if (!extension?.id || !extension.source || !extension.digest) {
        throw new Error("Invalid OCDX live extension registration");
      }
      const existing = extensions.get(extension.id);
      if (existing?.digest === extension.digest) {
        return { status: "unchanged", id: extension.id };
      }
      extensions.set(extension.id, extension);
      await Promise.all([...watchers.values()].map(({ contents }) => inject(contents, extension.id)));
      return {
        status: existing ? "updated" : "registered",
        id: extension.id
      };
    },
    async unregister(extensionID) {
      if (!extensions.delete(extensionID))
        return false;
      const source = `globalThis.__ocdx?.disable(${JSON.stringify(extensionID)})`;
      await Promise.allSettled([...watchers.values()].map(async ({ contents }) => {
        if (!isTarget(contents))
          return;
        await execute(contents, source);
        injected.get(Number(contents.id))?.delete(extensionID);
      }));
      return true;
    },
    async dispose() {
      if (disposed)
        return;
      disposed = true;
      app.removeListener("web-contents-created", created);
      for (const { contents, reload, destroy } of watchers.values()) {
        contents.removeListener?.("dom-ready", reload);
        contents.removeListener?.("destroyed", destroy);
      }
      await Promise.allSettled([...watchers.values()].map(({ contents }) => isTarget(contents) ? execute(contents, "globalThis.__ocdx?.dispose()") : Promise.resolve()));
      watchers.clear();
      injected.clear();
      queues.clear();
      extensions.clear();
      if (root.__ocdxLiveHost === host)
        delete root.__ocdxLiveHost;
    }
  };
  root.__ocdxLiveHost = host;
  try {
    return await host.register(payload.extension);
  } catch (error) {
    await host.dispose();
    throw error;
  }
}

// src/live/inspector.ts
import { execFile } from "child_process";
async function discoverInspector(pid) {
  const ports = await listeningPorts(pid);
  for (const port of ports) {
    const target = await inspectorTarget(port);
    if (target)
      return target;
  }
  return;
}
async function waitForInspector(pid, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  do {
    const target = await discoverInspector(pid);
    if (target)
      return target;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  return;
}

class InspectorSession {
  socket;
  static async connect(target, timeoutMs = 5000) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Timed out connecting to the Node inspector"));
      }, timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Could not connect to the Node inspector"));
      }, { once: true });
    });
    return new InspectorSession(socket);
  }
  nextID = 1;
  pending = new Map;
  constructor(socket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined)
        return;
      const pending = this.pending.get(message.id);
      if (!pending)
        return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "Inspector request failed"));
        return;
      }
      if (message.result?.exceptionDetails) {
        pending.reject(new Error("Electron-main bootstrap evaluation failed"));
        return;
      }
      pending.resolve(message.result?.result?.value);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Node inspector connection closed"));
      }
      this.pending.clear();
    });
  }
  evaluate(expression) {
    return this.request("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
  }
  scheduleClose() {
    return this.evaluate(`
      setTimeout(() => {
        try { process.getBuiltinModule("inspector").close(); } catch {}
      }, 250);
      true;
    `);
  }
  close() {
    this.socket.close();
  }
  request(method, params) {
    const id = this.nextID++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}
async function listeningPorts(pid) {
  try {
    const output = await execFileText("/usr/sbin/lsof", [
      "-nP",
      "-a",
      "-p",
      String(pid),
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fn"
    ]);
    const ports = new Set;
    for (const line of output.split(`
`)) {
      if (!line.startsWith("n"))
        continue;
      const match = line.match(/:(\d+)(?:\s|$)/);
      if (match)
        ports.add(Number(match[1]));
    }
    return [...ports];
  } catch {
    return [];
  }
}
async function inspectorTarget(port) {
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: controller.signal
    });
    if (!response.ok)
      return;
    const targets = await response.json();
    const target = targets.find((candidate) => candidate.type === "node" && typeof candidate.webSocketDebuggerUrl === "string");
    if (!target)
      return;
    const url = new URL(String(target.webSocketDebuggerUrl));
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return;
    }
    return { port, webSocketDebuggerUrl: url.toString() };
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }
}
function execFileText(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout) => {
      if (error)
        reject(error);
      else
        resolve(stdout);
    });
  });
}

// src/live/process.ts
import { execFile as execFile2 } from "child_process";
var OPEN_CODE_MAIN = /^\/.+\/OpenCode(?: Beta)?\.app\/Contents\/MacOS\/OpenCode(?: Beta)?(?:\s|$)/i;
function isOpenCodeDesktopMain(process2) {
  return OPEN_CODE_MAIN.test(process2.command) && !process2.command.includes(" --type=") && !process2.command.includes(" Helper");
}
async function findOpenCodeDesktopMain(startPid = process.pid, readProcess = readMacOSProcess) {
  const visited = new Set;
  let pid = startPid;
  while (pid > 1 && !visited.has(pid) && visited.size < 64) {
    visited.add(pid);
    const current = await readProcess(pid);
    if (!current)
      break;
    if (isOpenCodeDesktopMain(current))
      return current;
    if (current.ppid <= 1 || current.ppid === current.pid)
      break;
    pid = current.ppid;
  }
  return;
}
async function readMacOSProcess(pid) {
  try {
    const output = await execFileText2("/bin/ps", [
      "-p",
      String(pid),
      "-ww",
      "-o",
      "ppid=",
      "-o",
      "command="
    ]);
    const match = output.trim().match(/^(\d+)\s+(.+)$/s);
    if (!match)
      return;
    return { pid, ppid: Number(match[1]), command: match[2] };
  } catch {
    return;
  }
}
function execFileText2(file, args) {
  return new Promise((resolve, reject) => {
    execFile2(file, args, { encoding: "utf8" }, (error, stdout) => {
      if (error)
        reject(error);
      else
        resolve(stdout);
    });
  });
}

// src/live/index.ts
async function attachDesktopExtension(extension, options = {}) {
  const log = options.log ?? ((message) => console.error(`[ocdx-live] ${message}`));
  if (process.env.OPENCODE_CLIENT !== "desktop") {
    return { status: "skipped", reason: "OPENCODE_CLIENT is not desktop" };
  }
  if (process.platform !== "darwin") {
    return { status: "skipped", reason: "live attach currently supports macOS only" };
  }
  if (!extension.id || !extension.source) {
    return { status: "failed", reason: "extension id and source are required" };
  }
  try {
    const target = await findOpenCodeDesktopMain();
    if (!target) {
      throw new Error("OpenCode Desktop Electron main process was not found in the plugin ancestry");
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
    const runtimeSource = options.runtimeSource ?? await readFile(new URL("./runtime.js", import.meta.url), "utf8");
    const digest = createHash("sha256").update(extension.source).digest("hex");
    const session = await InspectorSession.connect(inspector);
    try {
      const result = await session.evaluate(createLiveHostExpression({
        runtimeSource,
        extension: { ...extension, digest },
        rendererURLPrefixes: options.rendererURLPrefixes ?? ["oc://renderer/"]
      }));
      const status = result?.status;
      if (status !== "registered" && status !== "updated" && status !== "unchanged") {
        throw new Error("The Electron-main host returned an invalid registration result");
      }
      return {
        status,
        extensionID: extension.id,
        electronPID: target.pid,
        inspectorPort: inspector.port,
        openedInspector
      };
    } finally {
      if (openedInspector) {
        await session.scheduleClose().catch((error) => log(`could not schedule inspector shutdown: ${error instanceof Error ? error.message : String(error)}`));
      }
      session.close();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(reason);
    return { status: "failed", reason };
  }
}

// examples/live-plugin/server.ts
async function bootstrap() {
  const source = await readFile2(new URL("./desktop.js", import.meta.url), "utf8");
  const runtimeSource = await readFile2(new URL("./runtime.js", import.meta.url), "utf8");
  await attachDesktopExtension({ id: "live-attach-demo", source }, { runtimeSource });
}
var server_default = {
  id: "ocdx-live-demo",
  async setup() {
    await bootstrap();
  },
  async server() {
    await bootstrap();
    return {};
  }
};
export {
  server_default as default
};
