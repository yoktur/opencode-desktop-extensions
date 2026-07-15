import { Icon } from "@opencode-ai/ui/v2/icon";
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2";
import { defineExtension, type DesktopTab } from "@hona/ocdx";
import { mountSolid } from "@hona/ocdx/solid";
import { For } from "solid-js";
import { createStore } from "solid-js/store";
import styles from "./styles.css?inline";

export default defineExtension({
  styles,
  activate(ocdx) {
    const enabled = ocdx.state.boolean("enabled", false);
    const size = ocdx.state.number("size", 232, { min: 184, max: 360 });
    const order = ocdx.state.value<string[]>("order", {
      default: [],
      decode: (value) =>
        Array.isArray(value) && value.every((item) => typeof item === "string")
          ? value
          : undefined,
    });
    const [view, setView] = createStore({
      tabs: orderTabs(ocdx.desktop.tabs.snapshot(), order.get()),
      dragging: undefined as string | undefined,
      dropKey: undefined as string | undefined,
      dropAfter: false,
    });

    const startDrag = (
      start: PointerEvent & { currentTarget: HTMLElement },
      source: string,
    ) => {
      if (start.button !== 0) return;
      if (
        start.target instanceof Element &&
        start.target.closest('[data-component="icon-button-v2"]')
      )
        return;
      const origin = start.clientY;
      let active = false;
      let target: string | undefined;
      let after = false;
      start.currentTarget.setPointerCapture(start.pointerId);

      const move = (event: PointerEvent) => {
        if (!active && Math.abs(event.clientY - origin) < 4) return;
        active = true;
        event.preventDefault();
        setView("dragging", source);
        const element = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-vertical-tab-key]");
        target = element?.dataset.verticalTabKey;
        if (!element || !target || target === source) {
          target = undefined;
          setView("dropKey", undefined);
          return;
        }
        const bounds = element.getBoundingClientRect();
        after = event.clientY > bounds.top + bounds.height / 2;
        setView("dropKey", target);
        setView("dropAfter", after);
      };

      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        if (active && target) {
          const tabs = moveTab([...view.tabs], source, target, after);
          setView("tabs", tabs);
          order.set(tabs.map((tab) => tab.id));
        }
        setView("dragging", undefined);
        setView("dropKey", undefined);
      };

      window.addEventListener("pointermove", move, {
        passive: false,
        signal: ocdx.lifecycle.signal,
      });
      window.addEventListener("pointerup", stop, {
        signal: ocdx.lifecycle.signal,
      });
      window.addEventListener("pointercancel", stop, {
        signal: ocdx.lifecycle.signal,
      });
    };

    const applyVisibility = (value: boolean) =>
      document.body.toggleAttribute("data-opencode-mod-vertical-tabs", value);
    applyVisibility(enabled.get());
    ocdx.lifecycle.own(enabled.subscribe(applyVisibility));
    ocdx.lifecycle.own(() =>
      document.body.removeAttribute("data-opencode-mod-vertical-tabs"),
    );

    ocdx.desktop.panes.add({
      id: "tabs",
      side: "left",
      size,
      open: enabled,
      minSize: 184,
      maxSize: 360,
      mount: mountSolid(() => (
        <div class="oc-mod-vertical-tabs">
          <div
            class="oc-mod-vertical-tabs-list"
            role="tablist"
            aria-label="Open tabs"
          >
            <For each={view.tabs}>
              {(tab) => (
                <div
                  class="oc-mod-vertical-tab"
                  data-active={tab.active}
                  data-vertical-tab-key={tab.id}
                  data-dragging={view.dragging === tab.id}
                  data-drop={
                    view.dropKey === tab.id
                      ? view.dropAfter
                        ? "after"
                        : "before"
                      : undefined
                  }
                  onPointerDown={(event) => startDrag(event, tab.id)}
                >
                  <button
                    type="button"
                    class="oc-mod-vertical-tab-main"
                    role="tab"
                    aria-selected={tab.active}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      ocdx.desktop.tabs.activate(tab.id);
                    }}
                  >
                    <span
                      class="oc-mod-vertical-tab-avatar"
                      ref={(element) => {
                        const avatar = ocdx.desktop.tabs.avatar(tab.id);
                        if (avatar) element.replaceChildren(avatar);
                      }}
                    />
                    <span class="oc-mod-vertical-tab-title">{tab.title}</span>
                  </button>
                  <IconButtonV2
                    type="button"
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="xmark-small" />}
                    onClick={() => ocdx.desktop.tabs.close(tab.id)}
                    aria-label={`Close ${tab.title}`}
                  />
                </div>
              )}
            </For>
            <div class="oc-mod-vertical-tabs-divider" />
            <button
              type="button"
              class="oc-mod-vertical-tabs-new"
              onClick={() => ocdx.desktop.tabs.create()}
            >
              <Icon name="plus" />
              <span>New tab</span>
              <kbd>Ctrl+T</kbd>
            </button>
          </div>
        </div>
      )),
    });

    ocdx.desktop.settings.toggle({
      id: "toggle",
      title: "Vertical tabs",
      description: "Move desktop tabs into a browser-style pane on the left.",
      value: enabled,
      after: "new-layout",
      badge: "New",
    });

    ocdx.lifecycle.own(
      ocdx.desktop.tabs.subscribe((tabs) =>
        setView("tabs", orderTabs(tabs, order.get())),
      ),
    );
  },
});

function orderTabs(tabs: readonly DesktopTab[], order: string[]) {
  const byID = new Map(tabs.map((tab) => [tab.id, tab]));
  return [
    ...order.flatMap((id) => (byID.has(id) ? [byID.get(id)!] : [])),
    ...tabs.filter((tab) => !order.includes(tab.id)),
  ];
}

function moveTab(
  tabs: DesktopTab[],
  source: string,
  target: string,
  after: boolean,
) {
  const tab = tabs.find((item) => item.id === source);
  if (!tab || source === target) return tabs;
  const next = tabs.filter((item) => item.id !== source);
  const index = next.findIndex((item) => item.id === target);
  next.splice(index + (after ? 1 : 0), 0, tab);
  return next;
}
