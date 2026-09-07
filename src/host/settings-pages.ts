import type { Dispose, SettingsPageContribution } from "../types";
import type { Report } from "./mounts";

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

export type SettingsPageSurface = ReturnType<typeof createSettingsPageSurface>;

/**
 * Injects extension pages into the settings dialog's vertical tabs. The
 * dialog's tabs are host-managed, so each injected page emulates the trigger
 * and panel markup and takes over selection state while it is active.
 */
export function createSettingsPageSurface(doc: Document, report: Report) {
  const pages = new Set<SettingsPageRecord>();

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

  const reconcile = () => {
    const tabs = doc.querySelector<HTMLElement>(
      'main [data-component="tabs-v2"][data-variant="settings"]',
    );
    const list = tabs?.querySelector<HTMLElement>('[data-slot="tabs-v2-list"]');
    pages.forEach((record) => {
      if (!tabs || !list) return unmountPage(record);
      if (
        record.mounted?.tabs === tabs &&
        record.mounted.navigation.isConnected
      )
        return;
      unmountPage(record);

      const navigation = doc.createElement("div");
      navigation.dataset.slot = "tabs-v2-trigger-wrapper";
      const value = `ocdx-${encodeURIComponent(record.extensionID)}-${encodeURIComponent(record.id)}`;
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
      panel.className = "settings-panel";
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
          .querySelectorAll<HTMLElement>('[data-slot="tabs-v2-trigger"]')
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
            ? event.target.closest<HTMLElement>('[data-slot="tabs-v2-trigger"]')
            : undefined;
        if (!trigger || trigger === button) return;
        hide();
        trigger.setAttribute("data-selected", "");
        trigger.setAttribute("data-highlighted", "");
        trigger.setAttribute("aria-selected", "true");
        trigger.tabIndex = 0;
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

  const add = (extensionID: string, contribution: SettingsPageContribution) => {
    const record: SettingsPageRecord = { ...contribution, extensionID };
    pages.add(record);
    reconcile();
    return () => {
      pages.delete(record);
      unmountPage(record);
    };
  };

  return {
    add,
    reconcile,
    unmountAll: () => pages.forEach(unmountPage),
  };
}
