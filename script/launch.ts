export {};

const executable = `release/ocdx${process.platform === "win32" ? ".exe" : ""}`;
const child = Bun.spawn([executable, ...Bun.argv.slice(2)], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await child.exited);
