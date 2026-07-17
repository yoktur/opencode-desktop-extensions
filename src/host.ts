import { createDesktop } from "./desktop";
import { createExtensionMainBridge } from "./bridge";
import { createOpenCodeSDK } from "./opencode";
import { createExtensionState } from "./state";
import type {
  Dispose,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionHost,
  ExtensionHostOptions,
  Mount,
  PaneController,
  PaneOptions,
  PaneSide,
  SettingsContribution,
  SettingsPageContribution,
  SurfaceContribution,
  UnsafeDesktopSurfaces,
} from "./types";

const STYLE = `
[data-opencode-mod-layout-shell] {
  --opencode-mod-layout-left: 0px;
  --opencode-mod-layout-right: 0px;
  --opencode-mod-layout-top: 0px;
  --opencode-mod-layout-bottom: 0px;
}

[data-opencode-mod-layout-shell] > main {
  box-sizing: border-box;
  padding-left: var(--opencode-mod-layout-left);
  padding-right: var(--opencode-mod-layout-right);
  padding-top: var(--opencode-mod-layout-top);
  padding-bottom: var(--opencode-mod-layout-bottom);
}

[data-opencode-mod-layout-rail] {
  position: absolute;
  z-index: 20;
  display: flex;
  min-width: 0;
  min-height: 0;
  pointer-events: none;
  background: var(--v2-background-bg-deep, var(--background-base));
}

[data-opencode-mod-layout-rail="left"],
[data-opencode-mod-layout-rail="right"] {
  top: var(--opencode-mod-titlebar-height, 36px);
  bottom: 0;
  flex-direction: row;
}

[data-opencode-mod-layout-rail="left"] { left: 0; }
[data-opencode-mod-layout-rail="right"] { right: 0; flex-direction: row-reverse; }

[data-opencode-mod-layout-rail="top"],
[data-opencode-mod-layout-rail="bottom"] {
  left: var(--opencode-mod-layout-left);
  right: var(--opencode-mod-layout-right);
  flex-direction: column;
}

[data-opencode-mod-layout-rail="top"] { top: var(--opencode-mod-titlebar-height, 36px); }
[data-opencode-mod-layout-rail="bottom"] { bottom: 0; flex-direction: column-reverse; }

[data-opencode-mod-pane] {
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  pointer-events: auto;
}

[data-opencode-mod-surface="titlebar"],
[data-opencode-mod-surface="settings"] { display: contents; }

[data-opencode-mod-surface="settings"]:not(:last-child) > [data-component="settings-v2-row"] {
  border-bottom: 0.5px solid var(--v2-border-border-base);
}

[data-opencode-mod-review-rail] {
  position: absolute;
  z-index: 10;
  display: flex;
  pointer-events: none;
}

[data-opencode-mod-review-rail="left"],
[data-opencode-mod-review-rail="right"] { top: 0; bottom: 0; }
[data-opencode-mod-review-rail="left"] { left: 0; }
[data-opencode-mod-review-rail="right"] { right: 0; flex-direction: row-reverse; }
[data-opencode-mod-review-rail="top"],
[data-opencode-mod-review-rail="bottom"] { left: 0; right: 0; flex-direction: column; }
[data-opencode-mod-review-rail="top"] { top: 0; }
[data-opencode-mod-review-rail="bottom"] { bottom: 0; flex-direction: column-reverse; }

#review-panel[data-opencode-mod-review] > :not([data-opencode-mod-review-rail]) {
  box-sizing: border-box;
  margin-left: var(--opencode-mod-review-left, 0px);
  margin-right: var(--opencode-mod-review-right, 0px);
  margin-top: var(--opencode-mod-review-top, 0px);
  margin-bottom: var(--opencode-mod-review-bottom, 0px);
  width: calc(100% - var(--opencode-mod-review-left, 0px) - var(--opencode-mod-review-right, 0px));
  height: calc(100% - var(--opencode-mod-review-top, 0px) - var(--opencode-mod-review-bottom, 0px));
}

[data-opencode-mod-resize] {
  position: absolute;
  z-index: 2;
  pointer-events: auto;
}

[data-opencode-mod-pane-side="left"] > [data-opencode-mod-resize],
[data-opencode-mod-pane-side="right"] > [data-opencode-mod-resize] {
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
}

[data-opencode-mod-pane-side="left"] > [data-opencode-mod-resize] { right: -8px; }
[data-opencode-mod-pane-side="right"] > [data-opencode-mod-resize] { left: -8px; }

[data-opencode-mod-pane-side="top"] > [data-opencode-mod-resize],
[data-opencode-mod-pane-side="bottom"] > [data-opencode-mod-resize] {
  left: 0;
  right: 0;
  height: 8px;
  cursor: row-resize;
}

[data-opencode-mod-pane-side="top"] > [data-opencode-mod-resize] { bottom: -8px; }
[data-opencode-mod-pane-side="bottom"] > [data-opencode-mod-resize] { top: -8px; }
`;

type Mounted = {
  slot: HTMLElement;
  dispose?: Dispose;
  abort: AbortController;
};

type ContributionRecord = {
  key: string;
  extensionID: string;
  order: number;
  mount: Mount;
  mounted?: Mounted;
  failedTarget?: HTMLElement;
  anchor?: string;
  placement?: "before" | "after";
};

type PaneRecord = ContributionRecord & {
  surface: "layout" | "review";
  side: PaneSide;
  value: {
    open: boolean;
    size: number;
  };
  minSize: number;
  maxSize: number;
  resizable: boolean;
  onOpenChange?: (open: boolean) => void;
  onSizeChange?: (size: number) => void;
};

type SettingsPageRecord = SettingsPageContribution & {
  extensionID: string;
  mounted?: {
    tabs: HTMLElement;
    navigation: HTMLElement;
    panel: HTMLElement;
    disposeNavigation?: Dispose;
    disposePanel?: Dispose;
    abortNavigation: AbortController;
    abortPanel: AbortController;
    hide: () => void;
    onTabsClick: (event: MouseEvent) => void;
  };
};

export function createExtensionHost(
  options: ExtensionHostOptions = {},
): ExtensionHost {
  const doc = options.document ?? document;
  const storage = options.storage ?? localStorage;
  const titlebar = new Set<ContributionRecord>();
  const settings = new Set<ContributionRecord>();
  const settingsPages = new Set<SettingsPageRecord>();
  const panes = new Set<PaneRecord>();
  const disposers = new Set<Dispose>();
  const style = doc.createElement("style");
  style.dataset.opencodeModStyles = "";
  style.textContent = STYLE;
  doc.head.append(style);

  const report = (error: unknown, extensionID: string) => {
    if (options.onError) return options.onError(error, extensionID);
    console.error(`[ocdx:${extensionID}]`, error);
  };

  const unmount = (record: ContributionRecord) => {
    if (!record.mounted) return;
    record.mounted.abort.abort();
    try {
      record.mounted.dispose?.();
    } catch (error) {
      report(error, record.extensionID);
    }
    record.mounted.slot.remove();
    record.mounted = undefined;
  };

  const unmountPage = (record: SettingsPageRecord) => {
    if (!record.mounted) return;
    record.mounted.hide();
    record.mounted.abortNavigation.abort();
    record.mounted.abortPanel.abort();
    record.mounted.tabs.removeEventListener(
      "click",
      record.mounted.onTabsClick,
    );
    [record.mounted.disposeNavigation, record.mounted.disposePanel].forEach(
      (dispose) => {
        try {
          dispose?.();
        } catch (error) {
          report(error, record.extensionID);
        }
      },
    );
    record.mounted.navigation.remove();
    record.mounted.panel.remove();
    record.mounted = undefined;
  };

  const mount = (
    record: ContributionRecord,
    target: HTMLElement,
    attributes: Record<string, string>,
    before: ChildNode | null = null,
  ) => {
    if (
      record.mounted?.slot.parentElement === target &&
      (before === null ||
        before === record.mounted.slot ||
        record.mounted.slot.nextSibling === before)
    ) {
      return;
    }
    if (record.failedTarget === target) return;
    unmount(record);
    const slot = doc.createElement("div");
    const abort = new AbortController();
    Object.entries(attributes).forEach(([key, value]) =>
      slot.setAttribute(key, value),
    );
    slot.dataset.opencodeModSlot = record.key;
    slot.style.order = `${record.order}`;
    target.insertBefore(slot, before);
    try {
      const dispose = record.mount(slot, { signal: abort.signal });
      record.mounted = {
        slot,
        abort,
        dispose: typeof dispose === "function" ? dispose : undefined,
      };
      record.failedTarget = undefined;
    } catch (error) {
      abort.abort();
      slot.remove();
      record.failedTarget = target;
      report(error, record.extensionID);
    }
  };

  const findSettingsTarget = () =>
    doc.querySelector<HTMLElement>(
      '[data-component="dialog-v2"][data-variant="settings"] .settings-v2-tab-body',
    );

  const paneSize = (record: PaneRecord) =>
    record.value.open ? record.value.size : 0;
  const sideSize = (surface: PaneRecord["surface"], side: PaneSide) =>
    Array.from(panes)
      .filter((record) => record.surface === surface && record.side === side)
      .reduce((total, record) => total + paneSize(record), 0);

  const updatePane = (record: PaneRecord) => {
    if (!record.mounted) return;
    record.mounted.slot.hidden = !record.value.open;
    record.mounted.slot.style.flexBasis = `${record.value.size}px`;
    if (record.side === "left" || record.side === "right") {
      record.mounted.slot.style.width = `${record.value.size}px`;
      record.mounted.slot.style.height = "100%";
      return;
    }
    record.mounted.slot.style.width = "100%";
    record.mounted.slot.style.height = `${record.value.size}px`;
  };

  const resize = (record: PaneRecord, value: number) => {
    const size = Math.max(
      record.minSize,
      Math.min(record.maxSize, Math.round(value)),
    );
    if (size === record.value.size) return;
    record.value.size = size;
    record.onSizeChange?.(size);
    reconcile();
  };

  const addResizeHandle = (record: PaneRecord) => {
    if (!record.resizable || !record.mounted) return;
    const handle = doc.createElement("div");
    handle.dataset.opencodeModResize = "";
    handle.addEventListener("pointerdown", (start) => {
      start.preventDefault();
      handle.setPointerCapture(start.pointerId);
      const initial = record.value.size;
      const move = (event: PointerEvent) => {
        const delta =
          record.side === "left"
            ? event.clientX - start.clientX
            : record.side === "right"
              ? start.clientX - event.clientX
              : record.side === "top"
                ? event.clientY - start.clientY
                : start.clientY - event.clientY;
        resize(record, initial + delta);
      };
      const stop = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", stop);
        doc.removeEventListener("pointercancel", stop);
        if (handle.hasPointerCapture(start.pointerId))
          handle.releasePointerCapture(start.pointerId);
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", stop);
      doc.addEventListener("pointercancel", stop);
    });
    record.mounted.slot.append(handle);
  };

  const ensureRail = (
    target: HTMLElement,
    surface: PaneRecord["surface"],
    side: PaneSide,
  ) => {
    const attribute =
      surface === "layout"
        ? "data-opencode-mod-layout-rail"
        : "data-opencode-mod-review-rail";
    const existing = Array.from(target.children).find(
      (child) => child.getAttribute(attribute) === side,
    );
    if (existing instanceof HTMLElement) return existing;
    const rail = doc.createElement("div");
    rail.setAttribute(attribute, side);
    target.append(rail);
    return rail;
  };

  const reconcileLayout = () => {
    const records = Array.from(panes).filter(
      (record) => record.surface === "layout",
    );
    if (records.length === 0) {
      doc
        .querySelectorAll<HTMLElement>("[data-opencode-mod-layout-shell]")
        .forEach((shell) => {
          shell
            .querySelectorAll(":scope > [data-opencode-mod-layout-rail]")
            .forEach((rail) => rail.remove());
          shell.removeAttribute("data-opencode-mod-layout-shell");
          ["left", "right", "top", "bottom"].forEach((side) =>
            shell.style.removeProperty(`--opencode-mod-layout-${side}`),
          );
        });
      return;
    }
    const header = doc.querySelector<HTMLElement>(
      'header[data-slot="titlebar-v2"]',
    );
    const shell = header?.parentElement;
    if (
      !header ||
      !shell ||
      !Array.from(shell.children).some((child) => child.tagName === "MAIN")
    ) {
      Array.from(panes)
        .filter((record) => record.surface === "layout")
        .forEach(unmount);
      return;
    }

    shell.dataset.opencodeModLayoutShell = "";
    shell.style.setProperty(
      "--opencode-mod-titlebar-height",
      `${Math.round(header.getBoundingClientRect().height) || 36}px`,
    );
    records.forEach((record) => {
      const before = record.mounted;
      mount(record, ensureRail(shell, "layout", record.side), {
        "data-opencode-mod-pane": record.key,
        "data-opencode-mod-pane-side": record.side,
      });
      if (record.mounted !== before) addResizeHandle(record);
      updatePane(record);
    });
    const sides: PaneSide[] = ["left", "right", "top", "bottom"];
    sides.forEach((side) => {
      const size = sideSize("layout", side);
      shell.style.setProperty(`--opencode-mod-layout-${side}`, `${size}px`);
      const rail = ensureRail(shell, "layout", side);
      if (side === "left" || side === "right") rail.style.width = `${size}px`;
      if (side === "top" || side === "bottom") rail.style.height = `${size}px`;
    });
  };

  const reconcileReview = () => {
    const records = Array.from(panes).filter(
      (record) => record.surface === "review",
    );
    if (records.length === 0) {
      doc
        .querySelectorAll<HTMLElement>(
          "#review-panel[data-opencode-mod-review]",
        )
        .forEach((review) => {
          review
            .querySelectorAll(":scope > [data-opencode-mod-review-rail]")
            .forEach((rail) => rail.remove());
          review.removeAttribute("data-opencode-mod-review");
          ["left", "right", "top", "bottom"].forEach((side) =>
            review.style.removeProperty(`--opencode-mod-review-${side}`),
          );
        });
      return;
    }
    const review = doc.getElementById("review-panel");
    if (!review) {
      Array.from(panes)
        .filter((record) => record.surface === "review")
        .forEach(unmount);
      return;
    }

    review.dataset.opencodeModReview = "";
    records.forEach((record) => {
      const before = record.mounted;
      mount(record, ensureRail(review, "review", record.side), {
        "data-opencode-mod-pane": record.key,
        "data-opencode-mod-pane-side": record.side,
      });
      if (record.mounted !== before) addResizeHandle(record);
      updatePane(record);
    });
    const sides: PaneSide[] = ["left", "right", "top", "bottom"];
    sides.forEach((side) => {
      const size = sideSize("review", side);
      review.style.setProperty(`--opencode-mod-review-${side}`, `${size}px`);
      const rail = ensureRail(review, "review", side);
      if (side === "left" || side === "right") rail.style.width = `${size}px`;
      if (side === "top" || side === "bottom") rail.style.height = `${size}px`;
    });
  };

  const reconcileSettingsPages = () => {
    const tabs = doc.querySelector<HTMLElement>(
      '[data-component="dialog-v2"][data-variant="settings"] [data-component="tabs-v2"][data-variant="settings"]',
    );
    const list = tabs?.querySelector<HTMLElement>('[data-slot="tabs-v2-list"]');
    settingsPages.forEach((record) => {
      if (!tabs || !list) return unmountPage(record);
      if (
        record.mounted?.tabs === tabs &&
        record.mounted.navigation.isConnected
      )
        return;
      unmountPage(record);

      const navigation = doc.createElement("div");
      navigation.dataset.slot = "tabs-v2-trigger-wrapper";
      const value = `ocdx-${record.id}`;
      navigation.dataset.value = value;
      const button = doc.createElement("button");
      button.type = "button";
      button.id = `${value}-trigger`;
      button.dataset.slot = "tabs-v2-trigger";
      button.dataset.value = value;
      button.dataset.key = value;
      button.dataset.orientation = "vertical";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", "false");
      button.tabIndex = -1;
      const navigationContent = doc.createElement("span");
      navigationContent.dataset.slot = "tabs-v2-trigger-content";
      navigationContent.className = "inline-flex items-center gap-2";
      button.append(navigationContent);
      navigation.append(button);

      const anchor = list.querySelector<HTMLElement>(
        `[data-slot="tabs-v2-trigger-wrapper"][data-value="${record.after ?? "shortcuts"}"]`,
      );
      if (anchor) anchor.after(navigation);
      else list.append(navigation);

      const panel = doc.createElement("div");
      panel.id = `${value}-content`;
      panel.className = "settings-v2-panel";
      panel.dataset.ocdxSettingsPage = record.id;
      panel.hidden = true;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", button.id);
      button.setAttribute("aria-controls", panel.id);
      tabs.append(panel);

      const hide = () => {
        delete button.dataset.selected;
        delete button.dataset.highlighted;
        button.setAttribute("aria-selected", "false");
        button.tabIndex = -1;
        panel.hidden = true;
        tabs
          .querySelectorAll<HTMLElement>('[data-slot="tabs-v2-content"]')
          .forEach((content) => content.style.removeProperty("display"));
      };
      const show = () => {
        tabs
          .querySelectorAll<HTMLElement>(
            '[data-slot="tabs-v2-trigger"]',
          )
          .forEach((trigger) => {
            trigger.removeAttribute("data-selected");
            trigger.removeAttribute("data-highlighted");
            trigger.setAttribute("aria-selected", "false");
            trigger.tabIndex = -1;
          });
        tabs
          .querySelectorAll<HTMLElement>('[data-slot="tabs-v2-content"]')
          .forEach((content) => content.style.setProperty("display", "none"));
        button.dataset.selected = "";
        button.dataset.highlighted = "";
        button.setAttribute("aria-selected", "true");
        button.tabIndex = 0;
        panel.hidden = false;
      };
      const onTabsClick = (event: MouseEvent) => {
        const trigger =
          event.target instanceof Element
            ? event.target.closest('[data-slot="tabs-v2-trigger"]')
            : undefined;
        if (!trigger || trigger === button) return;
        hide();
        trigger.setAttribute("data-selected", "");
        trigger.setAttribute("data-highlighted", "");
        trigger.setAttribute("aria-selected", "true");
        (trigger as HTMLElement).tabIndex = 0;
      };
      button.addEventListener("click", show);
      tabs.addEventListener("click", onTabsClick);
      const abortNavigation = new AbortController();
      const abortPanel = new AbortController();

      try {
        const disposeNavigation = record.navigation(navigationContent, {
          signal: abortNavigation.signal,
        });
        const disposePanel = record.mount(panel, {
          signal: abortPanel.signal,
        });
        record.mounted = {
          tabs,
          navigation,
          panel,
          disposeNavigation:
            typeof disposeNavigation === "function"
              ? disposeNavigation
              : undefined,
          disposePanel:
            typeof disposePanel === "function" ? disposePanel : undefined,
          abortNavigation,
          abortPanel,
          hide,
          onTabsClick,
        };
      } catch (error) {
        abortNavigation.abort();
        abortPanel.abort();
        navigation.remove();
        panel.remove();
        tabs.removeEventListener("click", onTabsClick);
        report(error, record.extensionID);
      }
    });
  };

  const reconcile = () => {
    const titlebarTarget = doc.getElementById("opencode-titlebar-right");
    titlebar.forEach((record) => {
      if (!titlebarTarget) return unmount(record);
      mount(record, titlebarTarget, {
        "data-opencode-mod-surface": "titlebar",
      });
    });
    const settingsTarget = findSettingsTarget();
    settings.forEach((record) => {
      if (!settingsTarget) return unmount(record);
      const anchor = record.anchor
        ? settingsTarget.querySelector(record.anchor)
        : undefined;
      if (record.anchor && !anchor) return unmount(record);
      if (anchor?.parentElement) {
        const before =
          record.placement === "before" ? anchor : anchor.nextSibling;
        mount(
          record,
          anchor.parentElement,
          { "data-opencode-mod-surface": "settings" },
          before,
        );
        return;
      }
      mount(record, settingsTarget, {
        "data-opencode-mod-surface": "settings",
      });
    });
    reconcileSettingsPages();
    reconcileLayout();
    reconcileReview();
  };

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      reconcile();
    });
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  const addContribution = (
    records: Set<ContributionRecord>,
    extensionID: string,
    contribution: SurfaceContribution | SettingsContribution,
  ) => {
    const record = {
      key: `${extensionID}/${contribution.id}`,
      extensionID,
      order: contribution.order ?? 0,
      mount: contribution.mount,
      anchor: "anchor" in contribution ? contribution.anchor : undefined,
      placement:
        "placement" in contribution ? contribution.placement : undefined,
    };
    records.add(record);
    reconcile();
    return () => {
      records.delete(record);
      unmount(record);
      reconcile();
    };
  };

  const addPane = (
    extensionID: string,
    surface: PaneRecord["surface"],
    options: PaneOptions,
  ): PaneController => {
    const size = Math.max(
      options.minSize ?? 160,
      Math.min(options.maxSize ?? 800, Math.round(options.size)),
    );
    const record: PaneRecord = {
      key: `${extensionID}/${options.id}`,
      extensionID,
      order: options.order ?? 0,
      mount: options.mount,
      surface,
      side: options.side,
      value: {
        open: options.open ?? true,
        size,
      },
      minSize: options.minSize ?? 160,
      maxSize: options.maxSize ?? 800,
      resizable: options.resizable ?? true,
      onOpenChange: options.onOpenChange,
      onSizeChange: options.onSizeChange,
    };
    panes.add(record);
    reconcile();

    const setOpen = (open: boolean) => {
      if (record.value.open === open) return;
      record.value.open = open;
      record.onOpenChange?.(open);
      reconcile();
    };
    const dispose = () => {
      panes.delete(record);
      unmount(record);
      reconcile();
    };
    return {
      open: () => record.value.open,
      size: () => record.value.size,
      show: () => setOpen(true),
      hide: () => setOpen(false),
      toggle: () => setOpen(!record.value.open),
      resize: (size) => resize(record, size),
      dispose,
    };
  };

  const addSettingsPage = (
    extensionID: string,
    contribution: SettingsPageContribution,
  ) => {
    const record: SettingsPageRecord = { ...contribution, extensionID };
    settingsPages.add(record);
    reconcile();
    return () => {
      settingsPages.delete(record);
      unmountPage(record);
      reconcile();
    };
  };

  const register = (extension: ExtensionDefinition) => {
    const owned = new Set<Dispose>();
    const cleanupOwned = () => {
      Array.from(owned)
        .reverse()
        .forEach((cleanup) => {
          try {
            cleanup();
          } catch (error) {
            report(error, extension.id);
          }
        });
      owned.clear();
    };
    const own = (dispose: Dispose) => {
      owned.add(dispose);
      return () => {
        owned.delete(dispose);
        dispose();
      };
    };
    const styles =
      typeof extension.styles === "string"
        ? [extension.styles]
        : (extension.styles ?? []);
    styles.forEach((css) => {
      const style = doc.createElement("style");
      style.dataset.ocdxExtension = extension.id;
      style.textContent = css;
      doc.head.append(style);
      owned.add(() => style.remove());
    });
    const controller = new AbortController();
    owned.add(() => controller.abort());
    const unsafe: UnsafeDesktopSurfaces = {
      titlebar: {
        add: (contribution) =>
          own(addContribution(titlebar, extension.id, contribution)),
      },
      settings: {
        add: (contribution) =>
          own(addContribution(settings, extension.id, contribution)),
        addPage: (contribution) =>
          own(addSettingsPage(extension.id, contribution)),
      },
      layout: {
        addPane: (paneOptions) => {
          const pane = addPane(extension.id, "layout", paneOptions);
          own(pane.dispose);
          return pane;
        },
      },
      review: {
        addPane: (paneOptions) => {
          const pane = addPane(extension.id, "review", paneOptions);
          own(pane.dispose);
          return pane;
        },
      },
    };
    const lifecycle = {
      signal: controller.signal,
      own,
      listen(
        target: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions | boolean,
      ) {
        target.addEventListener(type, listener, options);
        return own(() => target.removeEventListener(type, listener, options));
      },
      observe(
        target: Node,
        options: MutationObserverInit,
        callback: MutationCallback,
      ) {
        const observer = new MutationObserver(callback);
        observer.observe(target, options);
        return own(() => observer.disconnect());
      },
    };
    const assets = {
      url(value: string) {
        const parts = value.split("/").filter(Boolean);
        if (
          parts.length === 0 ||
          value.includes("\\") ||
          value.startsWith("/") ||
          parts.some((part) => part === "." || part === "..")
        ) {
          throw new Error(`Invalid extension asset path: ${value}`);
        }
        return `ocdx://mods/${encodeURIComponent(extension.id)}/${parts
          .map(encodeURIComponent)
          .join("/")}`;
      },
      fetch(value: string, init?: RequestInit) {
        return fetch(this.url(value), init);
      },
    };
    const desktop = createDesktop(unsafe, doc, own);
    const context: ExtensionContext = {
      id: extension.id,
      lifecycle,
      assets,
      main: createExtensionMainBridge(extension.id, controller.signal),
      state: createExtensionState(storage, extension.id),
      opencode: createOpenCodeSDK(desktop, own),
      desktop,
      unsafe,
    };
    try {
      const dispose = extension.activate(context);
      if (typeof dispose === "function") owned.add(dispose);
    } catch (error) {
      cleanupOwned();
      report(error, extension.id);
      throw error;
    }
    reconcile();

    const dispose = () => {
      cleanupOwned();
      disposers.delete(dispose);
    };
    disposers.add(dispose);
    return dispose;
  };

  return {
    register,
    dispose() {
      observer.disconnect();
      Array.from(disposers)
        .reverse()
        .forEach((dispose) => dispose());
      titlebar.forEach(unmount);
      settings.forEach(unmount);
      settingsPages.forEach(unmountPage);
      panes.forEach(unmount);
      style.remove();
    },
  };
}
