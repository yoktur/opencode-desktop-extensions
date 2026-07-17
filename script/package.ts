import { copyFile, cp, mkdir, rm } from "node:fs/promises";

const extension = process.platform === "win32" ? ".exe" : "";
const library =
  process.platform === "win32"
    ? "ocdx_launcher.dll"
    : process.platform === "darwin"
      ? "libocdx_launcher.dylib"
      : "libocdx_launcher.so";

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
const currentArtifacts = new Set(artifacts.map(([, destination]) => destination));
await Promise.all(
  [
    "release/ocdx",
    "release/ocdx.exe",
    "release/ocdx_launcher.dll",
    "release/libocdx_launcher.so",
    "release/libocdx_launcher.dylib",
  ]
    .filter((path) => !currentArtifacts.has(path))
    .map((path) => rm(path, { force: true })),
);

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

if (process.platform === "darwin") await packageMacApp();

async function packageMacApp() {
  const bundle = "release/OCDX.app";
  const contents = `${bundle}/Contents`;
  const macos = `${contents}/MacOS`;
  const resources = `${contents}/Resources`;
  await rm(bundle, { recursive: true, force: true });
  await mkdir(macos, { recursive: true });
  await mkdir(resources, { recursive: true });
  await Promise.all([
    copyFile("release/ocdx", `${macos}/ocdx`),
    copyFile("release/libocdx_launcher.dylib", `${macos}/libocdx_launcher.dylib`),
    copyFile("release/runtime.js", `${macos}/runtime.js`),
    cp("release/builtin", `${macos}/builtin`, { recursive: true }),
    cp("release/mods", `${macos}/mods`, { recursive: true }),
  ]);

  const icon = [
    "launcher/assets/icon.icns",
    "/Applications/OpenCode.app/Contents/Resources/icon.icns",
    "/Applications/OpenCode Beta.app/Contents/Resources/icon.icns",
  ].find((path) => Bun.file(path).size > 0);
  if (!icon) throw new Error("OpenCode icon.icns was not found");
  await copyFile(icon, `${resources}/OCDX.icns`);
  await Bun.write(
    `${contents}/Info.plist`,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>OCDX</string>
  <key>CFBundleExecutable</key><string>ocdx</string>
  <key>CFBundleIconFile</key><string>OCDX</string>
  <key>CFBundleIconName</key><string>OCDX</string>
  <key>CFBundleIdentifier</key><string>dev.hona.ocdx</string>
  <key>CFBundleName</key><string>OCDX</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`,
  );
  const signed = Bun.spawnSync([
    "codesign",
    "--force",
    "--deep",
    "--sign",
    "-",
    bundle,
  ]);
  if (signed.exitCode !== 0) {
    throw new Error(`codesign failed: ${signed.stderr.toString()}`);
  }
}
