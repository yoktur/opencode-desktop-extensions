import { Icon } from "@opencode-ai/ui/v2/icon";
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2";
import { defineExtension } from "@hona/ocdx";
import { mountSolid, useCell } from "@hona/ocdx/solid";
import { Show } from "solid-js";
import styles from "./styles.css?inline";

const ICON = "https://img.iconpusher.com/com.kiloo.subwaysurf/3.56.0.png";

export default defineExtension({
  styles,
  activate(ocdx) {
    const open = ocdx.state.boolean("open", false);
    const size = ocdx.state.number("size", 360, { min: 280, max: 520 });
    const video = ocdx.assets.url("assets/subway-surfers.webm");
    const pane = ocdx.desktop.panes.add({
      id: "gameplay",
      side: "right",
      size,
      open,
      minSize: 280,
      maxSize: 520,
      mount: mountSolid(() => (
        <div class="oc-mod-subway-pane">
          <div class="oc-mod-pane-header">
            <div class="oc-mod-pane-heading">
              <img src={ICON} alt="" />
              <span>Subway Surfers</span>
            </div>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="normal"
              icon={<Icon name="xmark-small" />}
              onClick={() => pane.hide()}
              aria-label="Close Subway Surfers"
            />
          </div>
          <div class="oc-mod-subway-video">
            <Show when={useCell(open)()}>
              <video
                src={video}
                aria-label="Subway Surfers gameplay"
                autoplay
                loop
                muted
                playsinline
              />
            </Show>
          </div>
        </div>
      )),
    });

    ocdx.desktop.titlebar.toggle({
      id: "toggle",
      label: "Subway Surfers",
      order: 20,
      checked: open,
      icon: (_checked) => <img class="oc-mod-subway-icon" src={ICON} alt="" />,
    });
  },
});
