import { Icon } from "@opencode-ai/ui/icon";
import { render } from "solid-js/web";
import { createCell } from "../state";
import type { DesktopSidePanel, Dispose } from "../types";
import type { Report } from "./mounts";

type Options = Parameters<DesktopSidePanel["add"]>[0];
type Entry = {
  key: string;
  extensionID: string;
  options: Options;
  active: ReturnType<typeof createCell<boolean>>;
  failedRoot?: HTMLElement;
  mounted?: {
    root: HTMLElement;
    list: HTMLElement;
    wrapper: HTMLElement;
    button: HTMLButtonElement;
    panel: HTMLElement;
    abort: AbortController;
    dispose: Dispose;
  };
};

// These are the current Desktop session tabs, not the separate settings tabs.
const ROOT = '#review-panel .session-review-v2-tabs-bar';
const TRIGGER = '[data-slot="tabs-trigger"]';

export function createSidePanelSurface(doc: Document, report: Report) {
  const entries = new Set<Entry>();
  let selected: Entry | undefined;
  let pending: Entry | undefined;
  const currentRoute = () => doc.querySelector('[data-titlebar-tab-slot][data-active="true"] [data-titlebar-tab-link]')?.getAttribute("href");
  let route = currentRoute();
  let native: HTMLButtonElement | undefined;
  let observed: HTMLElement | undefined;
  let keyboardList: HTMLElement | undefined;
  let keyboardAbort = new AbortController();
  const resize = new ResizeObserver(() => {
    selected?.mounted?.button.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  const hide = () => {
    if (!selected) return;
    const mounted = selected.mounted;
    selected.active.set(false);
    selected = undefined;
    if (mounted) {
      mounted.root.removeAttribute("data-ocdx-side-active");
      mounted.panel.hidden = true;
      mounted.button.removeAttribute("data-selected");
      mounted.button.setAttribute("aria-selected", "false");
      mounted.button.tabIndex = -1;
    }
    if (native?.isConnected) {
      native.setAttribute("data-selected", "");
      native.setAttribute("aria-selected", "true");
      native.tabIndex = 0;
    }
    native = undefined;
  };

  const select = (entry: Entry) => {
    const mounted = entry.mounted;
    if (!mounted) return;
    hide();
    // Native browser tabs own a WebContentsView above the renderer. Switch via
    // the host trigger so Desktop detaches that view before showing our panel.
    const fallback = mounted.list.querySelector<HTMLButtonElement>(
      `${TRIGGER}[data-value="review"]`,
    ) ?? Array.from(mounted.list.querySelectorAll<HTMLButtonElement>(TRIGGER))
      .find((button) => !button.closest("[data-ocdx-side-tab]") &&
        !button.id.startsWith("session-side-panel-browser-tab"));
    const browserSelected = mounted.list.querySelector(`${TRIGGER}[id^="session-side-panel-browser-tab"][aria-selected="true"]`);
    if (!fallback && browserSelected) {
      // A session can have only browser tabs and no Review tab. Ask the host's
      // add menu to open its file picker, giving it a native non-browser target.
      mounted.list.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.click();
      queueMicrotask(() => {
        const item = doc.querySelector<HTMLElement>('[role="menuitem"]:has(use[href="#opencode-v2-icon-open-file"])');
        if (!item) return report(new Error("Desktop's file tab action is unavailable"), entry.extensionID);
        item.click();
        pending = entry;
        reconcile();
      });
      return;
    }
    fallback?.click();
    native = fallback;
    if (native) {
      native.removeAttribute("data-selected");
      native.setAttribute("aria-selected", "false");
      native.tabIndex = -1;
    }
    selected = entry;
    mounted.root.dataset.ocdxSideActive = entry.key;
    mounted.button.setAttribute("data-selected", "");
    mounted.button.setAttribute("aria-selected", "true");
    mounted.button.tabIndex = 0;
    mounted.panel.hidden = false;
    mounted.button.scrollIntoView({ block: "nearest", inline: "nearest" });
    mounted.button.focus({ preventScroll: true });
    updateVisibility();
  };

  const updateVisibility = () => {
    const aside = doc.getElementById("review-panel");
    entries.forEach((entry) => entry.active.set(
      entry === selected && !!entry.mounted?.panel.isConnected &&
      !!aside && !aside.inert && aside.getAttribute("aria-hidden") !== "true",
    ));
  };

  const unmount = (entry: Entry) => {
    if (selected === entry) hide();
    if (!entry.mounted) return;
    entry.mounted.abort.abort();
    entry.mounted.dispose();
    entry.mounted.wrapper.remove();
    entry.mounted.panel.remove();
    entry.mounted = undefined;
  };

  const observer = new MutationObserver(() => {
    // A programmatic host selection (open file/browser/keyboard command) wins.
    if (selected?.mounted && Array.from(selected.mounted.list.querySelectorAll(TRIGGER))
      .some((button) => !button.closest("[data-ocdx-side-tab]") && button.getAttribute("aria-selected") === "true")) {
      native = undefined;
      hide();
    }
    updateVisibility();
  });

  const reconcile = () => {
    if (!entries.size) {
      observer.disconnect();
      resize.disconnect();
      keyboardAbort.abort();
      keyboardList = undefined;
      observed = undefined;
      return;
    }
    if (currentRoute() !== route) {
      hide();
      pending = undefined;
      route = currentRoute();
    }
    const bar = doc.querySelector<HTMLElement>(ROOT);
    const root = bar?.parentElement;
    const list = bar?.querySelector<HTMLElement>('[data-slot="tabs-list"]');
    const aside = doc.getElementById("review-panel");
    if (list !== keyboardList) {
      resize.disconnect();
      if (list) resize.observe(list);
      keyboardAbort.abort();
      keyboardAbort = new AbortController();
      keyboardList = list ?? undefined;
      list?.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const target = event.target instanceof Element ? event.target.closest(TRIGGER) : null;
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>(`${TRIGGER}:not([disabled])`));
        const index = buttons.indexOf(target as HTMLButtonElement);
        const rtl = getComputedStyle(list).direction === "rtl";
        const delta = (event.key === "ArrowRight") !== rtl ? 1 : -1;
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
          (index + delta + buttons.length) % buttons.length;
        buttons[next]?.click();
        buttons[next]?.focus();
      }, { capture: true, signal: keyboardAbort.signal });
    }
    if (aside !== observed) {
      observer.disconnect();
      observed = aside ?? undefined;
      if (aside) observer.observe(aside, {
        attributes: true, subtree: true,
        attributeFilter: ["aria-selected", "aria-hidden", "inert"],
      });
    }
    entries.forEach((entry) => {
      if (!root || !list) return unmount(entry);
      if (entry.failedRoot === root) return;
      if (entry.mounted?.root === root && entry.mounted.wrapper.isConnected) return;
      unmount(entry);
      const wrapper = doc.createElement("div");
      wrapper.dataset.slot = "tabs-trigger-wrapper";
      wrapper.dataset.ocdxSideTab = entry.key;
      const button = doc.createElement("button");
      button.type = "button";
      button.id = `ocdx-side-${encodeURIComponent(entry.key)}`;
      button.dataset.slot = "tabs-trigger";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", "false");
      button.tabIndex = -1;
      const label = doc.createElement("span");
      label.textContent = entry.options.title;
      label.dir = "auto";
      const badge = doc.createElement("span");
      badge.dataset.ocdxSideBadge = "";
      button.append(label, badge);
      wrapper.append(button);
      const panel = doc.createElement("div");
      panel.id = `${button.id}-panel`;
      panel.dataset.ocdxSideContent = entry.key;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", button.id);
      panel.tabIndex = 0;
      panel.hidden = true;
      button.setAttribute("aria-controls", panel.id);
      const anchor = Array.from(list.children).find((child) =>
        !child.hasAttribute("data-slot") && child.querySelector('button[aria-haspopup="menu"]'),
      ) ?? list.lastElementChild;
      list.insertBefore(wrapper, anchor);
      root.append(panel);
      const abort = new AbortController();
      const cleanups: Dispose[] = [];
      try {
        if (entry.options.icon) {
          const icon = doc.createElement("span");
          icon.setAttribute("aria-hidden", "true");
          button.prepend(icon);
          const value = entry.options.icon;
          cleanups.push(render(() => typeof value === "function" ? value() : <Icon name={value} size="small" />, icon));
        }
        if (entry.options.badge) cleanups.push(entry.options.badge.effect((value) => {
          badge.textContent = value === undefined || value === 0 ? "" : String(value);
          badge.hidden = !badge.textContent;
        }));
        else badge.hidden = true;
        const dispose = entry.options.mount(panel, { signal: abort.signal });
        if (dispose) cleanups.push(dispose);
        const onClick = (event: MouseEvent) => {
          const trigger = event.target instanceof Element ? event.target.closest(TRIGGER) : null;
          if (trigger === button) {
            event.stopPropagation();
            select(entry);
            return;
          }
          if (trigger && !trigger.closest("[data-ocdx-side-tab]")) hide();
        };
        list.addEventListener("click", onClick, { capture: true, signal: abort.signal });
        entry.mounted = { root, list, wrapper, button, panel, abort,
          dispose: () => cleanups.reverse().forEach((cleanup) => cleanup()) };
      } catch (error) {
        entry.failedRoot = root;
        abort.abort();
        cleanups.reverse().forEach((cleanup) => cleanup());
        wrapper.remove();
        panel.remove();
        report(error, entry.extensionID);
      }
    });
    if (pending?.mounted) {
      const entry = pending;
      pending = undefined;
      select(entry);
    }
    updateVisibility();
  };

  return {
    reconcile,
    add(extensionID: string, options: Options) {
      const key = `${extensionID}/${options.id}`;
      if (Array.from(entries).some((entry) => entry.key === key)) throw new Error(`Duplicate side-panel tab: ${key}`);
      const entry: Entry = { key, extensionID, options, active: createCell(false) };
      entries.add(entry);
      reconcile();
      return {
        active: { get: entry.active.get, subscribe: entry.active.subscribe, effect: entry.active.effect },
        show() {
          if (!entries.has(entry)) return;
          pending = entry;
          const toggle = doc.querySelector<HTMLButtonElement>('button[aria-controls="review-panel"]');
          if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
          reconcile();
        },
        hide() {
          if (pending === entry) pending = undefined;
          if (selected === entry) hide();
        },
        dispose() {
          if (pending === entry) pending = undefined;
          unmount(entry);
          entries.delete(entry);
          reconcile();
        },
      };
    },
    dispose() {
      resize.disconnect();
      keyboardAbort.abort();
      observer.disconnect();
      entries.forEach(unmount);
      entries.clear();
    },
  };
}
