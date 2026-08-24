# OpenCode Desktop Extensions

OCDX is a typed SDK and mod loader for extending the production OpenCode Desktop V2 interface without patching the installed app.

https://github.com/user-attachments/assets/b3a3bb6b-0c29-4d10-8f3e-bc8941aa9b59

```ts
import { defineExtension } from "@hona/ocdx";

export default defineExtension({
  activate(ocdx) {
    ocdx.desktop.titlebar.action({
      id: "hello",
      label: "Say hello",
      icon: "status",
      onPress: () => alert("Hello from OCDX"),
    });
  },
});
```

The extension ID, name, and version come from `manifest.json`. The build automatically registers the default export, bundles its CSS and renderer code, and creates the `.ocdx` archive.

# Demo Plugins

- [Extension Manager](./builtin/extension-manager)
- [Keep Awake](./examples/keep-awake)
- [Subway Surfers](./examples/subway-surfers)
- [Vertical Tabs](./examples/vertical-tabs)

## How It Works

OCDX uses [Electron-Hook](https://github.com/Hona/Electron-Hook) to start the installed production app with a temporary in-memory bootstrap. Its macOS backend uses dyld interposition while leaving the installed app and its signature untouched.

OpenCode's files, signatures, updater, and normal launcher remain untouched. The stable OCDX runtime loads independent `.ocdx` archives from a mods folder, so changing extensions never requires rebuilding the Rust launcher.

```text
release/
  builtin/
    ocdx.extension-manager.ocdx
  mods/
    subway-surfers.ocdx
    vertical-tabs.ocdx
    keep-awake.ocdx
  ocdx[.exe]
  ocdx_launcher.dll | libocdx_launcher.so | libocdx_launcher.dylib
  runtime.js
```

## Installing Extensions

Each `.ocdx` file is a ZIP archive:

```text
my-extension.ocdx
  manifest.json
  renderer.js
  assets/
```

Drop archives into either folder:

```text
release/mods/
%APPDATA%/OCDX/mods/
~/Library/Application Support/OCDX/mods/
```

The built-in **Extensions** settings page can also install local files, accept drag and drop, download an `.ocdx` URL, and enable or disable extensions live.

OCDX validates archive paths and manifests, extracts changed archives into its cache, and loads extensions independently. Extensions are trusted renderer code with access to OpenCode's exposed preload API. Only install extensions you trust.

## Build And Run

Requirements:

- Windows or macOS with the production OpenCode Desktop app installed
- [Bun](https://bun.sh)
- [Git LFS](https://git-lfs.com/) for example assets
- Stable Rust and platform build tools (MSVC on Windows, Xcode Command Line Tools on macOS)

```sh
bun install
git lfs pull
bun run build:all
bun run launch
```

Close an existing OpenCode Desktop instance before launching. To target another production installation:

```sh
bun run launch -- --executable "D:\Apps\OpenCode\OpenCode.exe"
```

On Windows, `release/ocdx.exe` embeds the same blue development icon. You can pin that executable directly to the taskbar or create a normal desktop shortcut to it.

On macOS, OCDX discovers both stable and beta installations. An explicit app bundle or executable also works:

```sh
bun run launch -- --executable "/Applications/OpenCode Beta.app"
```

`bun run build:all` also creates `release/OCDX.app` with OpenCode's blue icon. To install a Dock launcher, copy that app to `/Applications`, open it once, then drag **OCDX** from Applications to the Dock:

```sh
cp -R release/OCDX.app /Applications/OCDX.app
open /Applications/OCDX.app
```

The macOS equivalent of the Windows taskbar is the Dock. OCDX is a launcher rather than a background menu-bar app, so it does not remain in the menu bar after OpenCode starts.

After OpenCode installs an application update, quit the normally relaunched app and start it through OCDX again.

## Extension Structure

An extension repository needs a manifest, a renderer entry, and any local assets. A trusted main-process entry is optional:

```text
my-extension/
  assets/
  index.tsx
  main.ts        # optional trusted main-process entry
  manifest.json
  styles.css
```

```json
{
  "schema": 1,
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "entry": "renderer.js",
  "main": "main.cjs"
}
```

```tsx
import { defineExtension } from "@hona/ocdx";
import styles from "./styles.css?inline";

export default defineExtension({
  styles,
  activate(ocdx) {
    // Register contributions here.
  },
});
```

Styles are inserted and removed with the extension lifecycle. There is no manual registration or stylesheet cleanup.

## Context

```ts
activate(ocdx) {
  ocdx.id
  ocdx.lifecycle
  ocdx.assets
  ocdx.state
  ocdx.main
  ocdx.desktop
  ocdx.unsafe
}
```

### Main Process Entry

Extensions that need trusted Electron main-process behavior can add `main.ts` and declare `"main": "main.cjs"`. Main entries are unsandboxed code with the same privileges as OpenCode; only install archives you fully trust.

Core OCDX provides lifecycle ownership and an extension-namespaced typed method bridge, not feature-specific host APIs. Renderer extensions share one JavaScript realm, so this namespacing is not a security boundary.

```ts
// main.ts
import { defineMainExtension } from "@hona/ocdx/main";

export default defineMainExtension((ocdx) => ({
  status() {
    return { extension: ocdx.id };
  },
}));
```

```ts
// index.tsx
import type mainExtension from "./main";

const main = ocdx.main<typeof mainExtension>();
const status = await main.status();
```

### Lifecycle

Listeners, observers, asynchronous work, and arbitrary resources can share the extension lifecycle:

```ts
ocdx.lifecycle.listen(window, "resize", update);

ocdx.lifecycle.observe(document.body, { childList: true }, update);

ocdx.lifecycle.own(() => thirdPartyLibrary.destroy());

await fetch(url, { signal: ocdx.lifecycle.signal });
```

Everything registered through semantic Desktop APIs is owned automatically.

### Typed State

State cells validate persisted JSON, notify subscribers, and save changes automatically:

```ts
const enabled = ocdx.state.boolean("enabled", true);
const width = ocdx.state.number("width", 320, { min: 240, max: 640 });
const label = ocdx.state.string("label", "Inspector");

enabled.get();
enabled.set(false);
enabled.set((current) => !current);
enabled.subscribe(console.log);
```

`effect` runs immediately with the current value and again on every change, so applying state to the world is one line:

```ts
ocdx.lifecycle.own(enabled.effect(applyVisibility));
```

For structured state, decoding is explicit and type-safe:

```ts
const order = ocdx.state.value<string[]>("order", {
  default: [],
  decode: (value) =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : undefined,
});
```

### Assets

Asset URLs are scoped to the current manifest ID:

```ts
const icon = ocdx.assets.url("assets/icon.svg");
const data = await ocdx.assets
  .fetch("assets/data.json")
  .then((response) => response.json());
```

No extension ID is repeated in source code.

### OpenCode Server Client

OCDX exposes the published `@opencode-ai/client` promise client with Desktop's local server credentials already configured:

```ts
const client = await ocdx.opencode.client();
const current = ocdx.opencode.currentSession.get();

if (current) {
  const session = await client.session.get({ sessionID: current.id });
  console.log(session.data);
}
```

The current session is a reactive cell derived from the active Desktop tab:

```ts
ocdx.lifecycle.own(
  ocdx.opencode.currentSession.subscribe((session) => {
    console.log(session?.id, session?.server);
  }),
);
```

Select another known HTTP server when creating a client; V2 requests scope to directories and locations through their request inputs:

```ts
const client = await ocdx.opencode.client({
  server: "https://opencode.example.com",
});
```

The built-in sidecar is authenticated automatically. Plain HTTP server keys resolve directly; WSL and SSH credentials are not exposed by the current production preload contract.

## Desktop V2 APIs

OCDX only provides primitives for real OpenCode Desktop V2 surfaces and behavior. It does not ship a competing component library.

Use the published `@opencode-ai/ui` package for buttons, switches, inputs, badges, tabs, and other UI components.

### Titlebar

```tsx
const visible = ocdx.state.boolean("visible", false);

ocdx.desktop.titlebar.toggle({
  id: "inspector",
  label: "Toggle inspector",
  icon: (checked) => checked ? <InspectorOpenIcon /> : <InspectorClosedIcon />,
  checked: visible,
});
```

Custom icons can use normal Solid JSX:

```tsx
ocdx.desktop.titlebar.action({
  id: "custom",
  label: "Custom action",
  icon: () => <img src={ocdx.assets.url("assets/icon.png")} alt="" />,
  onPress: run,
});
```

### Settings

```ts
ocdx.desktop.settings.toggle({
  id: "enabled",
  title: "My extension",
  description: "Show the extension UI.",
  value: enabled,
  badge: "New",
});
```

Settings pages use the real Desktop navigation and accept extension-owned content:

```tsx
import { Button } from "@opencode-ai/ui/button";
import { mountSolid } from "@hona/ocdx/solid";

ocdx.desktop.settings.page({
  id: "my-extension",
  title: "My Extension",
  icon: "sliders",
  after: "shortcuts",
  mount: mountSolid(() => <Button>Run action</Button>),
});
```

### Panes

Pane visibility and size are reactive cells, so titlebar actions, settings, resizing, and persistence share one state source:

```tsx
import { mountSolid } from "@hona/ocdx/solid";

const pane = ocdx.desktop.panes.add({
  id: "inspector",
  side: "right",
  open: ocdx.state.boolean("open", false),
  size: ocdx.state.number("size", 360, { min: 240, max: 640 }),
  minSize: 240,
  maxSize: 640,
  mount: mountSolid(() => <Inspector />),
});

pane.show();
pane.hide();
pane.toggle();
```

Set `surface: "review"` to attach the pane to OpenCode's review surface instead of the app layout.

### OpenCode Tabs

The tabs service exposes actual Desktop tab state and actions. It does not provide a Vertical Tabs component.

```ts
const dispose = ocdx.desktop.tabs.subscribe((tabs) => {
  console.log(tabs);
});

ocdx.lifecycle.own(dispose);
ocdx.desktop.tabs.activate(tabID);
ocdx.desktop.tabs.close(tabID);
ocdx.desktop.tabs.create();
```

An extension decides how to present those tabs using normal Solid code and official OpenCode components.

## Solid Integration

`@hona/ocdx/solid` contains integration utilities, not UI components:

```tsx
import { mountSolid, useCell } from "@hona/ocdx/solid";

mountSolid(() => {
  const enabled = useCell(cell);
  return <Show when={enabled()}>...</Show>;
});
```

All actual controls come from `@opencode-ai/ui`.

## Full Control

The typed APIs cover common Desktop V2 integration, but they do not sandbox or constrain extensions. Authors can use normal DOM APIs, Solid, browser packages, and the published OpenCode UI package.

For experiments that do not fit semantic contribution points, `ocdx.unsafe` exposes the raw titlebar, settings, app-layout, and review mounts. Raw mounts still participate in OCDX lifecycle cleanup.

## Package

Once published:

```sh
bun add @hona/ocdx @opencode-ai/client @opencode-ai/ui solid-js
```

Public exports:

```text
@hona/ocdx
@hona/ocdx/main
@hona/ocdx/solid
```

The macOS launcher requires OpenCode's signed main executable to allow DYLD environment variables and disable library validation. Electron-Hook removes its DYLD entry before OpenCode spawns helpers, and verifies bootstrap readiness instead of silently opening an unmodified app if injection fails.

> Random footnote: a small `ocdx` command may eventually package and install archives, but the MVP deliberately uses ordinary build scripts and drag-and-drop files instead of shipping a CLI.

## License

MIT
