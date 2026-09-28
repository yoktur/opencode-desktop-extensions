import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { installLiveHost } from "../src/live/host";

class MockContents extends EventEmitter {
  id = 7;
  runtime = false;
  scripts: string[] = [];

  isDestroyed() {
    return false;
  }

  getURL() {
    return "oc://renderer/app";
  }

  async executeJavaScript(source: string) {
    if (source === "Boolean(globalThis.__ocdx)") return this.runtime;
    if (source.includes("sourceURL=ocdx-runtime.js")) this.runtime = true;
    this.scripts.push(source);
    return true;
  }
}

const payload = (source = "register-one") => ({
  runtimeSource: "runtime-source",
  rendererURLPrefixes: ["oc://renderer/"],
  extension: { id: "demo", source, digest: source },
});

afterEach(async () => {
  await (globalThis as any).__ocdxLiveHost?.dispose();
});

describe("Electron-main live host", () => {
  test("installs once and ignores duplicate registration", async () => {
    const app = new EventEmitter();
    const contents = new MockContents();
    const electron = {
      app,
      BrowserWindow: { getAllWindows: () => [{ webContents: contents }] },
    };

    expect(await installLiveHost(electron, payload())).toEqual({
      status: "registered",
      id: "demo",
    });
    const count = contents.scripts.length;
    expect(await installLiveHost(electron, payload())).toEqual({
      status: "unchanged",
      id: "demo",
    });
    expect(contents.scripts.length).toBe(count);
  });

  test("updates, unregisters, reinjects after reload, and disposes", async () => {
    const app = new EventEmitter();
    const contents = new MockContents();
    const electron = {
      app,
      BrowserWindow: { getAllWindows: () => [{ webContents: contents }] },
    };

    await installLiveHost(electron, payload());
    const host = (globalThis as any).__ocdxLiveHost;
    expect(await host.register(payload("register-two").extension)).toEqual({
      status: "updated",
      id: "demo",
    });
    contents.emit("dom-ready");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(contents.scripts.some((source) => source.includes("register-two")))
      .toBe(true);
    expect(await host.unregister("demo")).toBe(true);
    expect(host.extensions.size).toBe(0);
    await host.dispose();
    expect((globalThis as any).__ocdxLiveHost).toBeUndefined();
    expect(app.listenerCount("web-contents-created")).toBe(0);
  });
});
