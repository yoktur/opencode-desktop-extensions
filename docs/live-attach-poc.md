# Normal OpenCode Plugin to Desktop UI: Live Attach PoC

## Problem

OCDX currently starts an installed OpenCode payload through its Electron-Hook
launcher. That mode deliberately creates a separate OCDX channel with isolated
application identity, storage, server registration, credentials, and database.
It remains the right architecture for a managed extension environment.

This proof of concept adds a second backend for a different user flow:

```text
install one normal OpenCode plugin
  -> launch normal OpenCode Desktop
  -> the server plugin sees OPENCODE_CLIENT=desktop
  -> it bootstraps a persistent OCDX host into that Desktop process
  -> an OCDX renderer contribution appears in the existing Stable/Beta GUI
```

No OpenCode files are modified. The tester does not install OCDX or
Electron-Hook, use a special launcher, run an attach command, or enable
DevTools.

## Architecture

`@hona/ocdx/live` is an additive library entrypoint. A normal server plugin
passes it an already-bundled OCDX desktop entry:

```ts
import { readFile } from "node:fs/promises";
import { attachDesktopExtension } from "@hona/ocdx/live";

export default async function plugin() {
  const source = await readFile(new URL("./desktop.js", import.meta.url), "utf8");
  await attachDesktopExtension({ id: "my-plugin", source });
  return {};
}
```

The implementation has two reusable layers:

1. The server-side live bootstrap verifies the Desktop environment, walks only
   the plugin process ancestry, and accepts an ancestor only when its command is
   the expected OpenCode `.app` Electron main executable. It never searches for
   or signals an arbitrary matching process.
2. A serialized host is evaluated once in Electron main. It stores extension
   records on `globalThis.__ocdxLiveHost`, injects the existing OCDX renderer
   runtime, watches current and future web contents, reinjects after renderer
   reloads, suppresses duplicate registrations, and supports unregister and
   disposal.

The inspector is a bootstrap transport, not the renderer control plane. Once
the host is installed, Electron main uses `webContents.executeJavaScript()` for
current/new windows and reloads without reopening the inspector for each
operation.

## macOS Bootstrap

1. Return without side effects unless `OPENCODE_CLIENT=desktop`.
2. Walk parents from the server/plugin PID with `ps`.
3. Verify the ancestor command is an OpenCode or OpenCode Beta app main
   executable and has no Electron `--type` child-process flag.
4. Use `lsof` to discover inspector ports owned by that exact PID and probe
   their `/json/list` endpoints. No fixed port is used.
5. If no inspector is already open, send `SIGUSR1` to the verified PID and wait
   for a PID-owned Node inspector endpoint.
6. Connect over the Chrome DevTools Protocol and evaluate the idempotent host
   bootstrap using `process.getBuiltinModule("module").createRequire()` to load
   Electron.
7. Register the bundled renderer extension, schedule `inspector.close()` only
   when this bootstrap opened it, and close the WebSocket.

If validation or attachment fails, the plugin logs one diagnostic and returns a
`failed` result. Non-Desktop and unsupported-platform use returns `skipped`.

## Demo Package

`examples/live-plugin` has the conceptual normal-package layout:

```text
server.ts       normal OpenCode server plugin entry
index.tsx       OCDX desktop entry
manifest.json   desktop contribution identity
package.json    normal plugin package metadata
```

The build emits a self-contained package at `dist/live-plugin` with
`server.js`, `desktop.js`, and `runtime.js`. Its desktop entry uses the existing
`ocdx.desktop.titlebar.action()` API to add a conspicuous green status action.
Clicking it confirms that it was loaded by a normal OpenCode plugin.

The `live-demo-package` branch in the PoC fork contains only that built package
at its repository root so current OpenCode can install it through its normal Git
package flow. This branch is a test distribution artifact, not another source
tree.

## Build and Test

```sh
git lfs pull
bun install
bun run build
bun run typecheck
bun run test
bun run build:all
```

`bun run test` runs the live process/host tests, the existing channel test, and
the existing Playwright suite. On a restricted runner, Playwright needs
permission to launch and stop Chrome.

The live tests cover:

- rejecting non-Desktop process ancestry
- selecting only the verified OpenCode Electron main ancestor
- idempotent host installation and duplicate registration
- extension update, renderer reload reinjection, unregister, and disposal

## Try It on Stock OpenCode Desktop

These commands target the working fork artifact and OpenCode v2's current
plugin CLI:

```sh
opencode plugin add github:yoktur/opencode-desktop-extensions#live-demo-package
open -a OpenCode
```

After OpenCode starts, a green status action appears in the titlebar. Click it
to see the confirmation message. There is no attach or OCDX launcher step.

Remove the demo with the same configured package spec:

```sh
opencode plugin remove github:yoktur/opencode-desktop-extensions#live-demo-package
```

Installing a plugin into an already-running server is outside this PoC. Quit
and reopen normal Desktop after adding or removing it.

## Security

`SIGUSR1` temporarily exposes a Node inspector on loopback. Any same-machine
process able to connect while it is open can evaluate code with Electron-main
privileges. The PoC minimizes that window, verifies port ownership before
connecting, and closes only inspectors it opened. An inspector that was already
open is left alone. A production design should add stronger coordination,
timeouts, audit logging, and failure recovery around inspector shutdown.

The injected desktop extension is trusted code with renderer privileges, just
like an OCDX archive. This PoC does not introduce a sandbox or permission model.

## Current Limitations

- macOS only. Linux/Windows process discovery and signaling are not implemented.
- Relies on the shipped Electron fuse `EnableNodeCliInspectArguments` and Node's
  `SIGUSR1` inspector behavior.
- Relies on Desktop setting `OPENCODE_CLIENT=desktop` for its local sidecar.
- Recognizes OpenCode/OpenCode Beta `.app` main executables and renderers whose
  URL starts with `oc://renderer/`.
- Reuses the OCDX renderer runtime and semantic UI APIs. Launcher-specific
  `ocdx://` asset serving, main-extension RPC, extension management, and isolated
  sidecar connection are not implemented by the live backend yet.
- Registrations live for the lifetime of the Electron main process. Updating the
  bootstrap/runtime itself requires a normal Desktop restart.
- Each independently loaded server plugin still needs one temporary inspector
  connection to register with the persistent host; renderer operations and
  reloads do not.
- This is not production-hardened against hostile local processes, Electron or
  OpenCode version drift, crashes during the short inspector-open window, or
  multiple sidecars racing to bootstrap.

## Upstream Behavior Relied On

- The Desktop sidecar exports `OPENCODE_CLIENT=desktop`.
- The server plugin process remains a descendant of Electron main.
- The OpenCode app executable and renderer URL retain their current identities.
- Electron main can load `electron` through a require created from
  `process.execPath`.
- `BrowserWindow.getAllWindows()` and `webContents.executeJavaScript()` remain
  available from Electron main.
- The production build keeps `EnableNodeCliInspectArguments` enabled.

## Backend Comparison

| | Existing Electron-Hook backend | New live backend |
|---|---|---|
| Start model | OCDX launcher starts installed payload | Normal Desktop starts normally |
| Channel | Separate isolated OCDX channel | Existing Stable/Beta channel |
| Bootstrap | Electron-Hook before app startup | Temporary Node inspector after startup |
| Installed files | Unmodified | Unmodified |
| Extension source | `.ocdx` archives and manager | Normal server plugin bundles/registers desktop source |
| Lifecycle | Full launcher bootstrap and protocols | Persistent in-process host for windows/reloads |
| Main extensions/assets | Supported | Not yet supported |
| Platforms | Existing launcher platforms | macOS PoC only |

The live backend is additive. It does not replace the launcher, archive format,
isolated channel, or Electron-Hook implementation.

## Longer-Term Package Shape

A future OpenCode convention could let a normal package expose separate targets:

```json
{
  "exports": {
    "./server": "./dist/server.js",
    "./desktop": "./dist/desktop.js"
  }
}
```

OpenCode does not currently discover a `./desktop` target. In this PoC the
server entry explicitly registers its bundled desktop entry through
`@hona/ocdx/live`. Standardizing optional desktop contributions is a separate,
longer-term OpenCode proposal; it is not required for the live-attach backend.
