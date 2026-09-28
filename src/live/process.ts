import { execFile } from "node:child_process";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  uid?: number;
  command: string;
}

export type ReadProcess = (pid: number) => Promise<ProcessInfo | undefined>;
export type ListProcesses = () => Promise<ProcessInfo[]>;

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
  listProcesses: ListProcesses = listMacOSProcesses,
  uid = process.getuid?.(),
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

  const candidates = (await listProcesses()).filter(
    (candidate) =>
      isOpenCodeDesktopMain(candidate) &&
      (uid === undefined || candidate.uid === undefined || candidate.uid === uid),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

export async function verifyOpenCodeDesktopBundle(target: ProcessInfo) {
  const executable = target.command.match(OPEN_CODE_MAIN)?.[0].trim();
  const marker = ".app/Contents/MacOS/";
  const index = executable?.indexOf(marker) ?? -1;
  if (!executable || index === -1) return false;
  const plist = `${executable.slice(0, index + 4)}/Contents/Info.plist`;
  try {
    const identifier = (
      await execFileText("/usr/bin/plutil", [
        "-extract",
        "CFBundleIdentifier",
        "raw",
        "-o",
        "-",
        plist,
      ])
    ).trim();
    return /^ai\.opencode\.desktop(?:\.beta)?$/.test(identifier);
  } catch {
    return false;
  }
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
    return {
      pid,
      ppid: Number(match[1]),
      uid: await processUID(pid),
      command: match[2],
    };
  } catch {
    return undefined;
  }
}

export async function listMacOSProcesses() {
  const output = await execFileText("/bin/ps", [
    "-axo",
    "pid=,ppid=,uid=,command=",
  ]);
  return output
    .split("\n")
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/s);
      return match
        ? [
            {
              pid: Number(match[1]),
              ppid: Number(match[2]),
              uid: Number(match[3]),
              command: match[4],
            },
          ]
        : [];
    });
}

async function processUID(pid: number) {
  const output = await execFileText("/bin/ps", ["-p", String(pid), "-o", "uid="]);
  const uid = Number(output.trim());
  return Number.isInteger(uid) ? uid : undefined;
}

function execFileText(file: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
