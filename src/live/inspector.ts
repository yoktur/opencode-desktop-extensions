import { execFile } from "node:child_process";

export interface InspectorTarget {
  port: number;
  webSocketDebuggerUrl: string;
}

type InspectorMessage = {
  id?: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
  error?: { message?: string };
};

export async function discoverInspector(pid: number) {
  const ports = await listeningPorts(pid);
  for (const port of ports) {
    const target = await inspectorTarget(port);
    if (target) return target;
  }
  return undefined;
}

export async function waitForInspector(
  pid: number,
  options: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  do {
    const target = await discoverInspector(pid);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  return undefined;
}

export class InspectorSession {
  static async connect(target: InspectorTarget, timeoutMs = 5_000) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          socket.close();
          reject(new Error("Timed out connecting to the Node inspector"));
        },
        timeoutMs,
      );
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

  private nextID = 1;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as InspectorMessage;
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
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

  evaluate(expression: string) {
    return this.request("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
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

  private request(method: string, params: Record<string, unknown>) {
    const id = this.nextID++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function listeningPorts(pid: number) {
  try {
    const output = await execFileText("/usr/sbin/lsof", [
      "-nP",
      "-a",
      "-p",
      String(pid),
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fn",
    ]);
    const ports = new Set<number>();
    for (const line of output.split("\n")) {
      if (!line.startsWith("n")) continue;
      const match = line.match(/:(\d+)(?:\s|$)/);
      if (match) ports.add(Number(match[1]));
    }
    return [...ports];
  } catch {
    return [];
  }
}

async function inspectorTarget(port: number): Promise<InspectorTarget | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const targets = (await response.json()) as Array<Record<string, unknown>>;
    const target = targets.find(
      (candidate) =>
        candidate.type === "node" &&
        typeof candidate.webSocketDebuggerUrl === "string",
    );
    if (!target) return undefined;
    const url = new URL(String(target.webSocketDebuggerUrl));
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return undefined;
    }
    return { port, webSocketDebuggerUrl: url.toString() };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function execFileText(file: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
