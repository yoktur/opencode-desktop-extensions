import { execFile } from "node:child_process";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}

export type ReadProcess = (pid: number) => Promise<ProcessInfo | undefined>;

const OPEN_CODE_MAIN =
  /^\/.+\/OpenCode(?: Beta)?\.app\/Contents\/MacOS\/OpenCode(?: Beta)?(?:\s|$)/i;

export function isOpenCodeDesktopMain(process: ProcessInfo) {
  return (
    OPEN_CODE_MAIN.test(process.command) &&
    !process.command.includes(" --type=") &&
    !process.command.includes(" Helper")
  );
}

export async function findOpenCodeDesktopMain(
  startPid = process.pid,
  readProcess: ReadProcess = readMacOSProcess,
) {
  const visited = new Set<number>();
  let pid = startPid;

  while (pid > 1 && !visited.has(pid) && visited.size < 64) {
    visited.add(pid);
    const current = await readProcess(pid);
    if (!current) break;
    if (isOpenCodeDesktopMain(current)) return current;
    if (current.ppid <= 1 || current.ppid === current.pid) break;
    pid = current.ppid;
  }

  return undefined;
}

export async function readMacOSProcess(pid: number) {
  try {
    const output = await execFileText("/bin/ps", [
      "-p",
      String(pid),
      "-ww",
      "-o",
      "ppid=",
      "-o",
      "command=",
    ]);
    const match = output.trim().match(/^(\d+)\s+(.+)$/s);
    if (!match) return undefined;
    return { pid, ppid: Number(match[1]), command: match[2] };
  } catch {
    return undefined;
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
