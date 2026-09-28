import { describe, expect, test } from "bun:test";
import {
  findOpenCodeDesktopMain,
  isOpenCodeDesktopMain,
  type ProcessInfo,
} from "../src/live/process";

const main: ProcessInfo = {
  pid: 100,
  ppid: 1,
  command: "/Applications/OpenCode.app/Contents/MacOS/OpenCode",
};

describe("OpenCode Desktop process detection", () => {
  test("accepts only the Electron main executable", () => {
    expect(isOpenCodeDesktopMain(main)).toBe(true);
    expect(
      isOpenCodeDesktopMain({
        ...main,
        command:
          "/Applications/OpenCode.app/Contents/MacOS/OpenCode --type=renderer",
      }),
    ).toBe(false);
    expect(
      isOpenCodeDesktopMain({
        ...main,
        command:
          "/Applications/Other.app/Contents/MacOS/Other",
      }),
    ).toBe(false);
  });

  test("walks the plugin ancestry instead of searching all processes", async () => {
    const processes = new Map<number, ProcessInfo>([
      [300, { pid: 300, ppid: 200, command: "/usr/local/bin/bun sidecar" }],
      [200, { pid: 200, ppid: 100, command: "OpenCode Helper (Plugin)" }],
      [100, main],
    ]);
    expect(await findOpenCodeDesktopMain(300, async (pid) => processes.get(pid)))
      .toEqual(main);
  });

  test("returns undefined when ancestry cannot be verified", async () => {
    const processes = new Map<number, ProcessInfo>([
      [300, { pid: 300, ppid: 200, command: "/usr/local/bin/bun" }],
      [200, { pid: 200, ppid: 1, command: "/bin/zsh" }],
    ]);
    expect(await findOpenCodeDesktopMain(300, async (pid) => processes.get(pid)))
      .toBeUndefined();
  });
});
