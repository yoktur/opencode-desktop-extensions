import { describe, expect, test } from "bun:test";
import plugin from "../examples/live-plugin/server";

describe("normal OpenCode demo package", () => {
  test("exports native v2 setup and v1 server entrypoints", () => {
    expect(plugin.id).toBe("ocdx-live-demo");
    expect(plugin.setup).toBeFunction();
    expect(plugin.server).toBeFunction();
  });
});
