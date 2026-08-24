import { Badge } from "@opencode-ai/ui/badge";
import { Button } from "@opencode-ai/ui/button";
import { Switch } from "@opencode-ai/ui/switch";
import { TextInput } from "@opencode-ai/ui/text-input";
import { Icon } from "@opencode-ai/ui/icon";
import { defineExtension } from "@hona/ocdx";
import { mountSolid } from "@hona/ocdx/solid";
import { For, Show, onMount, type JSX, type ParentProps } from "solid-js";
import { createStore } from "solid-js/store";
import styles from "./styles.css?inline";

type InstalledExtension = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  builtin: boolean;
  hasMain: boolean;
};

export default defineExtension({
  styles,
  activate(ocdx) {
    // Desktop's own settings already have an "Extensions" tab, so this page
    // sits after it under the OCDX name.
    ocdx.desktop.settings.page({
      id: "extensions",
      after: "extensions",
      title: "OCDX",
      icon: () => <Icon name="dot-grid" />,
      mount: mountSolid(() => <ExtensionManager />),
    });
  },
});

function ExtensionManager() {
  const [state, setState] = createStore({
    extensions: [] as InstalledExtension[],
    url: "",
    busy: false,
    dragging: false,
    error: "",
  });
  let picker!: HTMLInputElement;

  const refresh = async () => {
    const result = await request<{ extensions: InstalledExtension[] }>(
      "/extensions",
    );
    setState(
      "extensions",
      result.extensions.toSorted(
        (a, b) =>
          Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name),
      ),
    );
  };

  const perform = async (action: () => Promise<unknown>) => {
    setState({ busy: true, error: "" });
    try {
      await action();
      return true;
    } catch (error) {
      setState("error", error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setState("busy", false);
    }
  };

  const installFiles = async (files: FileList | File[]) => {
    const archives = Array.from(files).filter((file) =>
      file.name.toLowerCase().endsWith(".ocdx"),
    );
    if (archives.length === 0) {
      setState("error", "Choose one or more .ocdx files.");
      return;
    }
    const installed = await perform(async () => {
      for (const file of archives) {
        await request(`/install?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: await file.arrayBuffer(),
        });
      }
    });
    if (installed) await refresh();
  };

  const installURL = async () => {
    const url = state.url.trim();
    if (!url) return;
    const installed = await perform(() =>
      request("/install-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }),
    );
    if (installed) {
      setState("url", "");
      await refresh();
    }
  };

  const toggle = async (extension: InstalledExtension, enabled: boolean) => {
    const toggled = await perform(() =>
      request("/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: extension.id, enabled }),
      }),
    );
    if (toggled) {
      setState(
        "extensions",
        (item) => item.id === extension.id,
        "enabled",
        enabled,
      );
    }
  };

  onMount(
    () => void refresh().catch((error) => setState("error", String(error))),
  );

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <h2 class="settings-tab-title">OCDX Extensions</h2>
        </div>
      </div>
      <div class="settings-tab-body ocdx-manager-body">
        <section class="settings-section ocdx-manager-install">
          <h3 class="settings-section-title">Install extensions</h3>
          <div
            class="ocdx-manager-drop"
            data-dragging={state.dragging}
            onDragEnter={(event) => {
              event.preventDefault();
              setState("dragging", true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node))
                return;
              setState("dragging", false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setState("dragging", false);
              if (event.dataTransfer)
                void installFiles(event.dataTransfer.files);
            }}
          >
            <div>
              <strong>Drop extension files</strong>
              <span>Choose one or more .ocdx archives from your computer</span>
            </div>
            <Button
              type="button"
              size="small"
              variant="neutral"
              disabled={state.busy}
              onClick={() => picker.click()}
            >
              Browse
            </Button>
            <input
              ref={picker}
              type="file"
              accept=".ocdx"
              multiple
              hidden
              onChange={(event) => {
                if (event.currentTarget.files)
                  void installFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
          <div class="ocdx-manager-method-label">Or install from a URL</div>
          <div class="ocdx-manager-url">
            <TextInput
              appearance="large"
              value={state.url}
              placeholder="https://example.com/my-extension.ocdx"
              aria-label="Extension URL"
              disabled={state.busy}
              onInput={(event) => setState("url", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void installURL();
              }}
            />
            <Button
              type="button"
              size="normal"
              variant="neutral"
              disabled={state.busy || !state.url.trim()}
              onClick={() => void installURL()}
            >
              Install
            </Button>
          </div>
        </section>

        <Show when={state.error}>
          <div class="ocdx-manager-error">{state.error}</div>
        </Show>

        <SettingsSection title="Installed extensions">
          <Show
            when={state.extensions.length > 0}
            fallback={
              <div class="ocdx-manager-empty">No extensions installed.</div>
            }
          >
            <For each={state.extensions}>
              {(extension) => (
                <SettingsRow
                  title={
                    <span class="ocdx-manager-extension-title">
                      {extension.name}
                      <Badge variant="neutral">v{extension.version}</Badge>
                      <Show when={extension.builtin}>
                        <Badge variant="accent">Built-in</Badge>
                      </Show>
                      <Show when={extension.hasMain}>
                        <Badge variant="neutral">Main process</Badge>
                      </Show>
                    </span>
                  }
                  description={extension.id}
                  control={
                    <Switch
                      checked={extension.enabled}
                      disabled={extension.builtin || state.busy}
                      onChange={(enabled) => void toggle(extension, enabled)}
                      hideLabel
                    >
                      Enable {extension.name}
                    </Switch>
                  }
                />
              )}
            </For>
          </Show>
        </SettingsSection>
      </div>
    </>
  );
}

async function request<T = unknown>(path: string, init?: RequestInit) {
  const response = await fetch(`ocdx://manager${path}`, init);
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      result.error || `Request failed with status ${response.status}`,
    );
  return result;
}

function SettingsSection(props: ParentProps<{ title: JSX.Element }>) {
  return (
    <section class="settings-section">
      <h3 class="settings-section-title">{props.title}</h3>
      <div data-component="settings-list">{props.children}</div>
    </section>
  );
}

function SettingsRow(props: {
  title: JSX.Element;
  description?: JSX.Element;
  control: JSX.Element;
}) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.control}</div>
    </div>
  );
}
