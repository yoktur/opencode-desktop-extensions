import { Badge } from "@opencode-ai/ui/badge";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Switch } from "@opencode-ai/ui/switch";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { useCell } from "./solid";
import { createCell } from "./state";
import type {
  DesktopIcon,
  DesktopSidePanel,
  DesktopTab,
  Dispose,
  OpenCodeDesktop,
  UnsafeDesktopSurfaces,
} from "./types";

const SETTINGS_TOGGLE_ANCHOR =
  '[data-component="settings-row"]:has([data-action="settings-auto-accept-permissions"]), [data-component="settings-row"]:has([data-action="settings-language"])';

export function createDesktop(
  surfaces: UnsafeDesktopSurfaces,
  document: Document,
  own: (dispose: Dispose) => Dispose,
  sidePanel: DesktopSidePanel,
): OpenCodeDesktop {
  const icon = (value: DesktopIcon) =>
    typeof value === "function" ? value() : <Icon name={value} />;

  return {
    titlebar: {
      action(options) {
        return surfaces.titlebar.add({
          id: options.id,
          order: options.order,
          mount: (target) =>
            render(
              () => (
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  size="large"
                  class="!w-9 shrink-0"
                  icon={icon(options.icon)}
                  onClick={options.onPress}
                  aria-label={options.label}
                  title={options.label}
                />
              ),
              target,
            ),
        });
      },
      toggle(options) {
        return surfaces.titlebar.add({
          id: options.id,
          order: options.order,
          mount: (target) =>
            render(() => {
              const checked = useCell(options.checked);
              return (
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  size="large"
                  class="!w-9 shrink-0"
                  state={checked() ? "pressed" : undefined}
                  icon={options.icon(checked())}
                  onClick={() => options.checked.set((value) => !value)}
                  aria-label={options.label}
                  aria-pressed={checked()}
                  title={options.label}
                />
              );
            }, target),
        });
      },
    },
    settings: {
      toggle(options) {
        return surfaces.settings.add({
          id: options.id,
          anchor: SETTINGS_TOGGLE_ANCHOR,
          placement: "after",
          mount: (target) =>
            render(() => {
              const value = useCell(options.value);
              return (
                <SettingsRow
                  title={
                    <span class="flex items-center gap-2">
                      {options.title}
                      {options.badge ? (
                        <Badge variant="accent">{options.badge}</Badge>
                      ) : undefined}
                    </span>
                  }
                  description={options.description}
                  control={
                    <Switch
                      checked={value()}
                      onChange={(checked) => options.value.set(checked)}
                      hideLabel
                    >
                      {options.title}
                    </Switch>
                  }
                />
              );
            }, target),
        });
      },
      page(options) {
        return surfaces.settings.addPage({
          id: options.id,
          after: options.after ?? "shortcuts",
          navigation: (target) =>
            render(
              () => (
                <>
                  {icon(options.icon)}
                  {options.title}
                </>
              ),
              target,
            ),
          mount: options.mount,
        });
      },
    },
    panes: {
      add(options) {
        const open = options.open ?? createCell(true);
        const size = options.size;
        const target =
          options.surface === "review" ? surfaces.review : surfaces.layout;
        const pane = target.addPane({
          id: options.id,
          side: options.side,
          size: size.get(),
          minSize: options.minSize,
          maxSize: options.maxSize,
          open: open.get(),
          resizable: options.resizable,
          mount: options.mount,
          onOpenChange: (value) => open.set(value),
          onSizeChange: (value) => size.set(value),
        });
        const disposeOpen = open.subscribe((value) =>
          value ? pane.show() : pane.hide(),
        );
        const disposeSize = size.subscribe((value) => pane.resize(value));
        const result = {
          open,
          size,
          show: () => open.set(true),
          hide: () => open.set(false),
          toggle: () => open.set((value) => !value),
          dispose() {
            disposeOpen();
            disposeSize();
            pane.dispose();
          },
        };
        own(result.dispose);
        return result;
      },
    },
    tabs: createTabs(document),
    sidePanel,
  };
}

function createTabs(document: Document): OpenCodeDesktop["tabs"] {
  const find = (id: string) =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-titlebar-tab-slot][data-tab-key]",
      ),
    ).find((slot) => slot.dataset.tabKey === id);

  const snapshot = (): DesktopTab[] =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-titlebar-tab-slot][data-tab-key]",
      ),
    ).map((slot) => {
      const href =
        slot
          .querySelector<HTMLElement>("[data-titlebar-tab-link]")
          ?.getAttribute("href") ?? undefined;
      return {
        id: slot.dataset.tabKey ?? "",
        title:
          slot
            .querySelector<HTMLElement>("[data-titlebar-tab-title]")
            ?.textContent?.trim() || "Untitled",
        active: slot.dataset.active === "true",
        href,
        session: parseSession(href),
      };
    });

  return {
    snapshot,
    subscribe(listener) {
      let signature = "";
      const publish = () => {
        const tabs = snapshot();
        const next = JSON.stringify(tabs);
        if (signature === next) return;
        signature = next;
        listener(tabs);
      };
      publish();
      const observer = new MutationObserver(publish);
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-active", "data-tab-key"],
        characterData: true,
        childList: true,
        subtree: true,
      });
      return () => observer.disconnect();
    },
    activate(id) {
      const link = find(id)?.querySelector<HTMLElement>(
        "[data-titlebar-tab-link]",
      );
      if (!link) return false;
      link.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      return true;
    },
    close(id) {
      const button = find(id)?.querySelector<HTMLButtonElement>(
        '[data-slot="tab-close"] button',
      );
      if (!button) return false;
      button.click();
      return true;
    },
    create() {
      const button = document
        .querySelector(
          'header[data-slot="titlebar-v2"] use[href="#opencode-v2-icon-plus"]',
        )
        ?.closest<HTMLButtonElement>("button");
      if (!button) return false;
      button.click();
      return true;
    },
  };
}

function parseSession(href?: string) {
  const match = href?.match(/^\/server\/([^/]+)\/session\/([^/?#]+)/);
  if (!match) return;
  try {
    const binary = atob(match[1].replace(/-/g, "+").replace(/_/g, "/"));
    const server = new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
    return { server, id: decodeURIComponent(match[2]) };
  } catch {
    return;
  }
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
