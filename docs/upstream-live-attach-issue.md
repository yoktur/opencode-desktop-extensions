# Proposal: optional live-attach backend for normal OpenCode Desktop

I would like to make it possible for a user to install one normal OpenCode
plugin, launch normal OpenCode Desktop as usual, and have that package's
optional desktop contribution appear in the existing Stable/Beta GUI. The user
would not install OCDX separately, use a special launcher, run an attach
command, or modify the installed application.

A working macOS-first fork/PoC exists here:

https://github.com/yoktur/opencode-desktop-extensions/tree/feat/live-attach-poc

Current OCDX intentionally launches the installed OpenCode payload in a
separate isolated OCDX channel through Electron-Hook. That keeps its identity,
storage, Chromium profile, server registration, credentials, and database
separate from Stable/Beta. I am not proposing to replace that architecture.

The PoC adds an optional live backend for normal, already-running Desktop. The
path has been verified on a current production macOS build:

```text
SIGUSR1
  -> Node inspector in Electron main
  -> Runtime.evaluate
  -> require("electron") via process.getBuiltinModule("module")
  -> BrowserWindow.getAllWindows()
  -> webContents.executeJavaScript()
  -> existing OCDX renderer runtime and semantic contribution API
```

The normal server plugin first requires `OPENCODE_CLIENT=desktop` and walks its
own process ancestry. Because the persistent service can be orphaned under PID
1 after Desktop restarts, the fallback requires exactly one same-user OpenCode
main candidate. It verifies the expected `.app` main command and bundle ID
before signaling anything. It discovers inspector endpoints owned by that PID
with `lsof` rather than assuming port 9229. If no inspector is open,
it sends `SIGUSR1`, connects, installs an idempotent
`globalThis.__ocdxLiveHost`, registers the bundled desktop entry, and closes the
inspector it opened.

The persistent main-process host handles current and new windows, renderer
reload/navigation, duplicate registration, unregister, and disposal. The
inspector is only the bootstrap/registration transport; it is not reopened for
renderer operations. No installed OpenCode files or `app.asar` are changed.

The demo is a normal OpenCode plugin with a server entry and a bundled desktop
entry. It reuses `ocdx.desktop.titlebar.action()` and visibly adds a green
titlebar action to stock Desktop.

## Reproduction

On macOS with normal OpenCode Desktop installed:

```sh
opencode plugin add github:yoktur/opencode-desktop-extensions#live-demo-package
open -a OpenCode
```

A green status action should appear in the existing Desktop titlebar. Clicking
it shows a confirmation. There is no separate OCDX install, launcher, daemon,
or manual attach step.

Cleanup:

```sh
opencode plugin remove github:yoktur/opencode-desktop-extensions#live-demo-package
```

The source branch can be built and tested with:

```sh
git clone https://github.com/yoktur/opencode-desktop-extensions.git
cd opencode-desktop-extensions
git switch feat/live-attach-poc
git lfs pull
bun install
bun run build:all
bun run test
```

## Current limitations

- macOS first; other process/signal backends are not implemented.
- Relies on Electron's shipped `EnableNodeCliInspectArguments` fuse and Node's
  `SIGUSR1` behavior.
- Relies on `OPENCODE_CLIENT=desktop`, the current process ancestry, app command,
  and `oc://renderer/` URL.
- Temporarily opening the inspector has a local security cost. The PoC minimizes
  the window and closes only an inspector it opened, but production hardening is
  still needed.
- It currently proves renderer runtime/UI contributions. Launcher-specific
  `ocdx://` assets, main-extension RPC, manager UI, and isolated-sidecar services
  are not yet available through live mode.
- It is PoC-quality around version negotiation, crash recovery, races, and
  diagnostics.

Separately, this could eventually support normal OpenCode packages exposing an
optional `./desktop` contribution alongside `./server`. OpenCode does not need
to understand that target for the core live-attach proposal: today the server
entry can explicitly register its bundled desktop entry. I see standard package
metadata as a longer-term follow-up, not a prerequisite or part of this request.

Would you be interested in accepting an additional live backend in this
direction before substantial production-hardening work is done? I would value
guidance on whether the backend belongs in this repository and which runtime
capabilities should be generalized first, while keeping the existing launcher
and isolated channel intact.
