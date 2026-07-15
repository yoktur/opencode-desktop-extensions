import { copyFile, cp, mkdir, rm } from "node:fs/promises";

const extension = process.platform === "win32" ? ".exe" : "";
const library =
  process.platform === "win32" ? "ocdx_launcher.dll" : "libocdx_launcher.so";

await mkdir("release", { recursive: true });
await Promise.all([
  rm("release/renderer.js", { force: true }),
  rm("release/assets", { recursive: true, force: true }),
]);
const artifacts: Array<[string, string]> = [
  [`launcher/target/release/ocdx${extension}`, `release/ocdx${extension}`],
  [`launcher/target/release/${library}`, `release/${library}`],
  ["dist/runtime.js", "release/runtime.js"],
];

await Promise.all(
  artifacts.map(([source, destination]) =>
    copyFile(source, destination).catch((error: NodeJS.ErrnoException) => {
      if (
        (error.code === "EPERM" || error.code === "EBUSY") &&
        Bun.file(destination).size === Bun.file(source).size
      ) {
        return;
      }
      throw error;
    }),
  ),
);
await rm("release/mods", { recursive: true, force: true });
await rm("release/builtin", { recursive: true, force: true });
await cp("dist/extensions", "release/mods", { recursive: true, force: true });
await cp("dist/builtin", "release/builtin", { recursive: true, force: true });
