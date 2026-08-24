export const HOST_STYLE = `
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

[data-opencode-mod-surface="settings"]:not(:last-child) > [data-component="settings-row"] {
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
