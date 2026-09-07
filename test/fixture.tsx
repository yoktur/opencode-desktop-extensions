import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { Tabs } from "@opencode-ai/ui/tabs";
import { createExtensionHost } from "../src/host";

render(() => {
  const [open, setOpen] = createSignal(true);
  const [route, setRoute] = createSignal("one");
  const [active, setActive] = createSignal("review");
  return <>
    <header data-slot="titlebar-v2">
      <div id="opencode-titlebar-right" />
      <div data-titlebar-tab-slot data-active="true"><a data-titlebar-tab-link href={route()}>Session</a></div>
    </header>
    <button onClick={() => setRoute("two")}>Change session</button>
    <button onClick={() => setActive("browser")}>Programmatic browser</button>
    <button aria-controls="review-panel" aria-expanded={open()} onClick={() => setOpen(!open())}>Toggle panel</button>
    <main>
      <aside id="review-panel" aria-hidden={!open()} inert={!open()} style={{ width: "600px", height: "500px" }}>
        <Show when={open()}>
          <Tabs value={active()} onChange={setActive}>
            <div class="session-review-v2-tabs-bar">
              <Tabs.List>
                <Tabs.Trigger value="review">Review</Tabs.Trigger>
                <Tabs.Trigger value="browser" id="session-side-panel-browser-tab-one">Browser</Tabs.Trigger>
                <Tabs.Trigger value="file">File</Tabs.Trigger>
                <div><button>Add tab</button></div>
              </Tabs.List>
            </div>
            <Tabs.Content value="review">Review content</Tabs.Content>
            <Tabs.Content value="browser">Browser content</Tabs.Content>
            <Tabs.Content value="file">File content</Tabs.Content>
          </Tabs>
        </Show>
      </aside>
    </main>
  </>;
}, document.getElementById("app")!);

const host = createExtensionHost();
for (const title of ["Inspector", "Test results"]) {
  const dispose = host.register({ id: title, name: title, activate(ctx) {
    const tab = ctx.desktop.sidePanel.add({ id: "panel", title, mount(el, { signal }) {
      const input = document.createElement("input");
      input.setAttribute("aria-label", `${title} input`);
      el.append(input);
      signal.addEventListener("abort", () => document.body.dataset.aborted = title);
    } });
    ctx.desktop.titlebar.action({ id: "show", label: `Show ${title}`, icon: "code", onPress: tab.show });
    ctx.lifecycle.own(tab.active.effect((active) => document.body.setAttribute(`data-active-${title.replaceAll(" ", "-")}`, String(active))));
  } });
  const button = document.createElement("button");
  button.textContent = `Disable ${title}`;
  button.onclick = dispose;
  document.body.append(button);
}
