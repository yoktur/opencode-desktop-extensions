import { createDesktop } from "../desktop";
import { createExtensionMainBridge } from "../bridge";
import { createOpenCodeSDK } from "../opencode";
import { createExtensionState } from "../state";
import type {
  Dispose,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionHost,
  SettingsContribution,
  SurfaceContribution,
  UnsafeDesktopSurfaces,
} from "../types";
import { HOST_STYLE } from "./css";
import { createMounter, type ContributionRecord } from "./mounts";
import { createPaneSurface } from "./panes";
import { createSettingsPageSurface } from "./settings-pages";

const SETTINGS_TARGET =
  '[data-component="dialog-v2"][data-variant="settings"] .settings-tab-body';

export function createExtensionHost(): ExtensionHost {
  const doc = document;
  const titlebar = new Set<ContributionRecord>();
  const settings = new Set<ContributionRecord>();
  const disposers = new Set<Dispose>();
  const style = doc.createElement("style");
  style.dataset.opencodeModStyles = "";
  style.textContent = HOST_STYLE;
  doc.head.append(style);

  const report = (error: unknown, extensionID: string) =>
    console.error(`[ocdx:${extensionID}]`, error);
  const mounter = createMounter(doc, report);
  const panes = createPaneSurface(doc, mounter);
  const settingsPages = createSettingsPageSurface(doc, report);

  const reconcile = () => {
    const titlebarTarget = doc.getElementById("opencode-titlebar-right");
    titlebar.forEach((record) => {
      if (!titlebarTarget) return mounter.unmount(record);
      mounter.mount(record, titlebarTarget, {
        "data-opencode-mod-surface": "titlebar",
      });
    });
    const settingsTarget = doc.querySelector<HTMLElement>(SETTINGS_TARGET);
    settings.forEach((record) => {
      if (!settingsTarget) return mounter.unmount(record);
      const anchor = record.anchor
        ? settingsTarget.querySelector(record.anchor)
        : undefined;
      if (record.anchor && !anchor) return mounter.unmount(record);
      if (anchor?.parentElement) {
        const before =
          record.placement === "before" ? anchor : anchor.nextSibling;
        mounter.mount(
          record,
          anchor.parentElement,
          { "data-opencode-mod-surface": "settings" },
          before,
        );
        return;
      }
      mounter.mount(record, settingsTarget, {
        "data-opencode-mod-surface": "settings",
      });
    });
    settingsPages.reconcile();
    panes.reconcile();
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
    const record: ContributionRecord = {
      key: `${extensionID}/${contribution.id}`,
      extensionID,
      order: contribution.order ?? 0,
      mount: contribution.mount,
      state: { kind: "unmounted" },
      anchor: "anchor" in contribution ? contribution.anchor : undefined,
      placement:
        "placement" in contribution ? contribution.placement : undefined,
    };
    records.add(record);
    reconcile();
    return () => {
      records.delete(record);
      mounter.unmount(record);
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
          own(settingsPages.add(extension.id, contribution)),
      },
      layout: {
        addPane: (paneOptions) => {
          const pane = panes.add(extension.id, "layout", paneOptions);
          own(pane.dispose);
          return pane;
        },
      },
      review: {
        addPane: (paneOptions) => {
          const pane = panes.add(extension.id, "review", paneOptions);
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
      state: createExtensionState(localStorage, extension.id),
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
      titlebar.forEach(mounter.unmount);
      settings.forEach(mounter.unmount);
      settingsPages.unmountAll();
      panes.unmountAll();
      style.remove();
    },
  };
}
